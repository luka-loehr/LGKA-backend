const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const axios = require('axios');
const cron = require('node-cron');
const pdfParse = require('pdf-parse');
const { GoogleGenerativeAI } = require('@google/generative-ai');
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

// PDF URLs from the Flutter app
const PDF_URLS = {
  today: 'https://lessing-gymnasium-karlsruhe.de/stundenplan/schueler/v_schueler_heute.pdf',
  tomorrow: 'https://lessing-gymnasium-karlsruhe.de/stundenplan/schueler/v_schueler_morgen.pdf'
};

// Basic Auth credentials (from Flutter app)
const AUTH_CREDENTIALS = {
  username: 'vertretungsplan',
  password: 'ephraim'
};

// Initialize Google AI
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY || 'your-api-key-here');

// AI-only parsing - no mock data needed

// Helper function to normalize class names
function normalizeClassName(className) {
  console.log(`[DEBUG] normalizeClassName input: "${className}"`);
  if (!className) {
    console.log(`[DEBUG] normalizeClassName: empty input, returning empty string`);
    return '';
  }
  const normalized = className.toLowerCase().replace(/\s+/g, '');
  console.log(`[DEBUG] normalizeClassName output: "${normalized}"`);
  return normalized;
}

// Helper function to extract and parse PDF content
async function extractTextFromPDF(pdfBuffer) {
  try {
    console.log(`[DEBUG] extractTextFromPDF: Starting PDF parsing, buffer size: ${pdfBuffer.length} bytes`);
    const data = await pdfParse(pdfBuffer);
    console.log(`[DEBUG] extractTextFromPDF: PDF parsed successfully, text length: ${data.text.length} characters`);
    console.log(`[DEBUG] extractTextFromPDF: First 200 characters of text: "${data.text.substring(0, 200)}"`);
    return data.text;
  } catch (error) {
    console.error('[DEBUG] PDF parsing error:', error);
    throw new Error('Failed to parse PDF');
  }
}

// Simple AI test function - summarize PDF in 8 words
async function testAISummary(text, pdfName) {
  console.log(`[DEBUG] testAISummary: Testing AI with ${pdfName}, text length: ${text.length}`);
  
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
    
    const prompt = `Summarize this German school substitute plan in exactly 8 words:

${text}

Respond with exactly 8 words, nothing else.`;

    console.log(`[DEBUG] testAISummary: Sending summary prompt to Gemini for ${pdfName}...`);
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const aiText = response.text().trim();
    
    console.log(`[DEBUG] testAISummary: AI summary for ${pdfName}: "${aiText}"`);
    return aiText;
    
  } catch (error) {
    console.error(`[DEBUG] testAISummary: AI summary failed for ${pdfName}:`, error.message);
    return `AI unavailable - fallback summary for ${pdfName}`;
  }
}

// AI-powered function to parse German substitute plan format
async function parseSubstitutePlanWithAI(text, targetClass = null) {
  console.log(`[DEBUG] parseSubstitutePlanWithAI: Starting AI parse, text length: ${text.length}, targetClass: ${targetClass}`);
  
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
    
    const prompt = `Analyze this German substitute plan (Vertretungsplan) and extract ALL substitution entries as a JSON array.

IMPORTANT: Look for these patterns in the text:
- "Vertretung3 - 46abcdKob102kRCop102" = Substitution for period 3, classes 6abcd, teacher Kob, room 102, replacing teacher Cop
- "Entfall5 - 66c---------NphPieNWT3" = Cancellation for period 5, class 6c, subject Nph, teacher Pie, room NWT3  
- "Raum-Vtr.3 - 47bBruPh310PhBruPHHS" = Room change for period 3, class 7b, teacher Bru, subject Ph, new room 310, old room PHHS
- "Verlegung39cBrnF203ChBetCHHS" = Relocation for period 3, class 9c, teacher Brn, subject F, room 203, replacing Ch teacher Bet

Extract EVERY substitution entry and return as valid JSON array:
[
  {
    "type": "Vertretung|Entfall|Raum-Vtr|Verlegung",
    "period": "period number",
    "class": "class name (e.g. 6abcd, 7b, J12)",
    "subject": "subject abbreviation", 
    "teacher": "teacher name",
    "room": "room number",
    "originalSubject": "original subject if different",
    "originalTeacher": "original teacher if different",
    "originalRoom": "original room if different", 
    "notes": "additional notes",
    "timestamp": "${new Date().toISOString()}"
  }
]

${targetClass ? `FILTER: Only return entries for class "${targetClass}" (case-insensitive).` : ''}

TEXT TO ANALYZE:
${text}

Return ONLY valid JSON array, no explanations or markdown.`;

    console.log(`[DEBUG] parseSubstitutePlanWithAI: Sending parsing prompt to Gemini 2.0...`);
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const aiText = response.text().trim();
    
    console.log(`[DEBUG] parseSubstitutePlanWithAI: AI response length: ${aiText.length}`);
    console.log(`[DEBUG] parseSubstitutePlanWithAI: Raw AI response: ${aiText.substring(0, 300)}...`);
    
    // Clean up response and extract JSON
    let jsonStr = aiText;
    
    // Remove markdown code blocks if present
    jsonStr = jsonStr.replace(/```json\s*/g, '').replace(/```\s*/g, '');
    
    // Try to find JSON array
    const jsonMatch = jsonStr.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      jsonStr = jsonMatch[0];
    }
    
    console.log(`[DEBUG] parseSubstitutePlanWithAI: Cleaned JSON: ${jsonStr.substring(0, 200)}...`);
    
    const substitutions = JSON.parse(jsonStr);
    console.log(`[DEBUG] parseSubstitutePlanWithAI: Successfully parsed ${substitutions.length} substitutions with AI`);
    
    return substitutions;
    
  } catch (error) {
    console.error(`[DEBUG] parseSubstitutePlanWithAI: AI parsing failed:`, error.message);
    console.error(`[DEBUG] parseSubstitutePlanWithAI: Error details:`, error);
    
    // Return empty array instead of fallback since we're AI-only
    console.log(`[DEBUG] parseSubstitutePlanWithAI: Returning empty array - no fallback parsing`);
    return [];
  }
}



// Function to fetch and process PDFs
async function updateSubstitutePlans() {
  try {
    console.log('[DEBUG] updateSubstitutePlans: Starting update process...');
    console.log('[DEBUG] updateSubstitutePlans: PDF URLs:', PDF_URLS);
    
    console.log('[DEBUG] updateSubstitutePlans: Fetching today\'s PDF...');
    const todayResponse = await axios.get(PDF_URLS.today, { 
      responseType: 'arraybuffer',
      timeout: 10000,
      auth: {
        username: AUTH_CREDENTIALS.username,
        password: AUTH_CREDENTIALS.password
      },
      httpsAgent: new (require('https').Agent)({
        rejectUnauthorized: false // Allow self-signed certificates for development
      })
    });
    console.log(`[DEBUG] updateSubstitutePlans: Today's PDF fetched, status: ${todayResponse.status}, data size: ${todayResponse.data.byteLength} bytes`);
    
    console.log('[DEBUG] updateSubstitutePlans: Fetching tomorrow\'s PDF...');
    const tomorrowResponse = await axios.get(PDF_URLS.tomorrow, { 
      responseType: 'arraybuffer',
      timeout: 10000,
      auth: {
        username: AUTH_CREDENTIALS.username,
        password: AUTH_CREDENTIALS.password
      },
      httpsAgent: new (require('https').Agent)({
        rejectUnauthorized: false // Allow self-signed certificates for development
      })
    });
    console.log(`[DEBUG] updateSubstitutePlans: Tomorrow's PDF fetched, status: ${tomorrowResponse.status}, data size: ${tomorrowResponse.data.byteLength} bytes`);
    
    console.log('[DEBUG] updateSubstitutePlans: Extracting text from today\'s PDF...');
    const todayText = await extractTextFromPDF(Buffer.from(todayResponse.data));
    
    console.log('[DEBUG] updateSubstitutePlans: Extracting text from tomorrow\'s PDF...');
    const tomorrowText = await extractTextFromPDF(Buffer.from(tomorrowResponse.data));
    
    console.log('[DEBUG] updateSubstitutePlans: Testing AI with both PDFs...');
    const todaySummary = await testAISummary(todayText, 'today');
    const tomorrowSummary = await testAISummary(tomorrowText, 'tomorrow');
    console.log(`[DEBUG] updateSubstitutePlans: AI summaries completed - Today: "${todaySummary}", Tomorrow: "${tomorrowSummary}"`);
    
    console.log('[DEBUG] updateSubstitutePlans: Parsing today\'s substitutions with AI...');
    const todaySubstitutions = await parseSubstitutePlanWithAI(todayText);
    
    console.log('[DEBUG] updateSubstitutePlans: Parsing tomorrow\'s substitutions with AI...');
    const tomorrowSubstitutions = await parseSubstitutePlanWithAI(tomorrowText);
    
    const todayDate = new Date().toISOString().split('T')[0];
    const tomorrowDate = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const timestamp = new Date().toISOString();
    
    console.log(`[DEBUG] updateSubstitutePlans: Creating processed data structure...`);
    processedData = {
      today: {
        substitutions: todaySubstitutions,
        rawText: todayText,
        date: todayDate
      },
      tomorrow: {
        substitutions: tomorrowSubstitutions,
        rawText: tomorrowText,
        date: tomorrowDate
      },
      lastUpdated: timestamp,
      error: null
    };
    
    console.log(`[DEBUG] updateSubstitutePlans: Update completed successfully!`);
    console.log(`[DEBUG] updateSubstitutePlans: Today: ${processedData.today.substitutions.length} substitutions, Tomorrow: ${processedData.tomorrow.substitutions.length} substitutions`);
    
  } catch (error) {
    console.error('[DEBUG] updateSubstitutePlans: Error occurred:', error);
    console.error('[DEBUG] updateSubstitutePlans: Error stack:', error.stack);
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
  
  // For AI-parsed data, we can either filter existing results or re-parse with target class
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
app.listen(PORT, '0.0.0.0', async () => {
  console.log(`[DEBUG] Server startup: LGKA Backend server running on port ${PORT}`);
  console.log('[DEBUG] Server startup: Express app configured with middleware');
  console.log('[DEBUG] Server startup: Routes registered');
  console.log('[DEBUG] Server startup: Cron job scheduled for every 5 minutes');
  console.log('[DEBUG] Server startup: Performing initial data fetch...');
  await updateSubstitutePlans();
  console.log('[DEBUG] Server startup: Initial data fetch completed');
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