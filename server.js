const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const axios = require('axios');
const cron = require('node-cron');
const pdfParse = require('pdf-parse');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(helmet());
app.use(compression());
app.use(cors());
app.use(morgan('combined'));
app.use(express.json());

// In-memory cache for processed PDFs
let processedData = {
  today: null,
  tomorrow: null,
  lastUpdated: null,
  error: null
};

// PDF URLs (replace with actual LGKA URLs)
const PDF_URLS = {
  today: 'https://lgka.de/substitution-plans/today.pdf',
  tomorrow: 'https://lgka.de/substitution-plans/tomorrow.pdf'
};

// Helper function to normalize class names
function normalizeClassName(className) {
  if (!className) return '';
  return className.toLowerCase().replace(/\s+/g, '');
}

// Helper function to extract and parse PDF content
async function extractTextFromPDF(pdfBuffer) {
  try {
    const data = await pdfParse(pdfBuffer);
    return data.text;
  } catch (error) {
    console.error('PDF parsing error:', error);
    throw new Error('Failed to parse PDF');
  }
}

// Helper function to parse German substitute plan format
function parseSubstitutePlan(text, targetClass = null) {
  const lines = text.split('\n').filter(line => line.trim());
  const substitutions = [];
  
  // Common patterns in German substitute plans
  const substitutionPattern = /(\d+)\s+([^\s]+)\s+([^\s]+)\s+([^\s]+)\s+([^\s]+)\s*(.*)?/;
  
  for (const line of lines) {
    const match = line.match(substitutionPattern);
    if (match) {
      const [, period, originalClass, subject, teacher, room, notes = ''] = match;
      
      // If targetClass is specified, filter for that class
      if (targetClass && normalizeClassName(originalClass) !== normalizeClassName(targetClass)) {
        continue;
      }
      
      substitutions.push({
        period: period.trim(),
        class: originalClass.trim(),
        subject: subject.trim(),
        teacher: teacher.trim(),
        room: room.trim(),
        notes: notes.trim(),
        timestamp: new Date().toISOString()
      });
    }
  }
  
  return substitutions;
}

// Function to fetch and process PDFs
async function updateSubstitutePlans() {
  try {
    console.log('Updating substitute plans...');
    
    const todayResponse = await axios.get(PDF_URLS.today, { 
      responseType: 'arraybuffer',
      timeout: 10000
    });
    
    const tomorrowResponse = await axios.get(PDF_URLS.tomorrow, { 
      responseType: 'arraybuffer',
      timeout: 10000
    });
    
    const todayText = await extractTextFromPDF(Buffer.from(todayResponse.data));
    const tomorrowText = await extractTextFromPDF(Buffer.from(tomorrowResponse.data));
    
    processedData = {
      today: {
        substitutions: parseSubstitutePlan(todayText),
        rawText: todayText,
        date: new Date().toISOString().split('T')[0]
      },
      tomorrow: {
        substitutions: parseSubstitutePlan(tomorrowText),
        rawText: tomorrowText,
        date: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split('T')[0]
      },
      lastUpdated: new Date().toISOString(),
      error: null
    };
    
    console.log(`Updated successfully. Today: ${processedData.today.substitutions.length} substitutions, Tomorrow: ${processedData.tomorrow.substitutions.length} substitutions`);
    
  } catch (error) {
    console.error('Error updating substitute plans:', error);
    processedData.error = {
      message: error.message,
      timestamp: new Date().toISOString()
    };
  }
}

// Routes
app.get('/', (req, res) => {
  res.json({
    service: 'LGKA Backend API',
    version: '1.0.0',
    status: 'running',
    lastUpdated: processedData.lastUpdated,
    endpoints: {
      '/api/health': 'Health check',
      '/api/substitutions': 'Get all substitutions',
      '/api/substitutions/today': 'Get today\'s substitutions',
      '/api/substitutions/tomorrow': 'Get tomorrow\'s substitutions',
      '/api/substitutions/class/:className': 'Get substitutions for specific class'
    }
  });
});

app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    lastUpdated: processedData.lastUpdated,
    hasError: !!processedData.error
  });
});

app.get('/api/substitutions', (req, res) => {
  if (processedData.error) {
    return res.status(500).json({
      error: processedData.error,
      message: 'Error fetching substitute plans'
    });
  }
  
  res.json({
    today: processedData.today,
    tomorrow: processedData.tomorrow,
    lastUpdated: processedData.lastUpdated
  });
});

app.get('/api/substitutions/today', (req, res) => {
  if (processedData.error) {
    return res.status(500).json({
      error: processedData.error,
      message: 'Error fetching today\'s substitute plans'
    });
  }
  
  res.json({
    ...processedData.today,
    lastUpdated: processedData.lastUpdated
  });
});

app.get('/api/substitutions/tomorrow', (req, res) => {
  if (processedData.error) {
    return res.status(500).json({
      error: processedData.error,
      message: 'Error fetching tomorrow\'s substitute plans'
    });
  }
  
  res.json({
    ...processedData.tomorrow,
    lastUpdated: processedData.lastUpdated
  });
});

app.get('/api/substitutions/class/:className', (req, res) => {
  const { className } = req.params;
  const { day } = req.query; // 'today', 'tomorrow', or 'both' (default)
  
  if (processedData.error) {
    return res.status(500).json({
      error: processedData.error,
      message: 'Error fetching substitute plans'
    });
  }
  
  const result = {};
  
  if (day !== 'tomorrow') {
    result.today = {
      ...processedData.today,
      substitutions: processedData.today.substitutions.filter(sub => 
        normalizeClassName(sub.class) === normalizeClassName(className)
      )
    };
  }
  
  if (day !== 'today') {
    result.tomorrow = {
      ...processedData.tomorrow,
      substitutions: processedData.tomorrow.substitutions.filter(sub => 
        normalizeClassName(sub.class) === normalizeClassName(className)
      )
    };
  }
  
  res.json({
    ...result,
    targetClass: className,
    lastUpdated: processedData.lastUpdated
  });
});

// Force update endpoint (for manual refresh)
app.post('/api/update', async (req, res) => {
  try {
    await updateSubstitutePlans();
    res.json({
      message: 'Substitute plans updated successfully',
      lastUpdated: processedData.lastUpdated
    });
  } catch (error) {
    res.status(500).json({
      error: error.message,
      message: 'Failed to update substitute plans'
    });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    error: 'Internal Server Error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong!'
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: 'The requested resource was not found'
  });
});

// Schedule updates every 5 minutes
cron.schedule('*/5 * * * *', () => {
  console.log('Scheduled update triggered');
  updateSubstitutePlans();
});

// Start server
app.listen(PORT, async () => {
  console.log(`LGKA Backend server running on port ${PORT}`);
  console.log('Performing initial data fetch...');
  await updateSubstitutePlans();
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  process.exit(0);
}); 