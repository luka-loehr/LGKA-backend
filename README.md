# LGKA Backend API

A Node.js Express backend for the LGKA Flutter app, designed to run on Railway. This backend processes PDF substitute plans and provides a clean REST API for the mobile app.

## Features

- 🚀 **Railway Ready**: Optimized for Railway deployment
- 📄 **PDF Processing**: Automatically fetches and parses PDF substitute plans
- 🔄 **Auto Updates**: Checks for new plans every 5 minutes
- 🎯 **Class Filtering**: Filter substitutions by specific class
- 💾 **In-Memory Caching**: Fast response times with intelligent caching
- 🛡️ **Security**: Helmet, CORS, and compression middleware
- 📊 **Health Monitoring**: Built-in health check endpoint

## API Endpoints

### Health & Status
- `GET /` - API information and available endpoints
- `GET /api/health` - Health check for Railway monitoring

### Substitute Plans
- `GET /api/substitutions` - Get all substitute plans (today + tomorrow)
- `GET /api/substitutions/today` - Get today's substitute plans
- `GET /api/substitutions/tomorrow` - Get tomorrow's substitute plans
- `GET /api/substitutions/class/:className` - Get substitutions for a specific class
  - Query parameter: `?day=today|tomorrow|both` (default: both)

### Management
- `POST /api/update` - Manually trigger an update of substitute plans

## Example API Responses

### Get substitutions for class "9B"
```bash
GET /api/substitutions/class/9B
```

```json
{
  "today": {
    "substitutions": [
      {
        "period": "3",
        "class": "9B",
        "subject": "Mathe",
        "teacher": "Müller",
        "room": "R201",
        "notes": "Aufgaben S. 45",
        "timestamp": "2024-01-15T10:30:00.000Z"
      }
    ],
    "date": "2024-01-15"
  },
  "tomorrow": {
    "substitutions": [],
    "date": "2024-01-16"
  },
  "targetClass": "9B",
  "lastUpdated": "2024-01-15T10:30:00.000Z"
}
```

## Railway Deployment

### 1. One-Click Deploy
[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/template/your-template-id)

### 2. Manual Deployment

1. **Fork this repository**

2. **Connect to Railway**:
   - Go to [Railway](https://railway.app)
   - Click "New Project" → "Deploy from GitHub repo"
   - Select your forked repository

3. **Environment Variables**:
   Railway will automatically set `PORT`. Optionally configure:
   ```
   NODE_ENV=production
   TODAY_PDF_URL=https://your-school.de/today.pdf
   TOMORROW_PDF_URL=https://your-school.de/tomorrow.pdf
   ```

4. **Deploy**:
   Railway will automatically build and deploy your app.

## Local Development

### Prerequisites
- Node.js 18+ 
- npm or yarn

### Setup
```bash
# Clone the repository
git clone <your-repo>
cd lgka-backend

# Install dependencies
npm install

# Copy environment variables
cp .env.example .env

# Edit .env with your PDF URLs
nano .env

# Start development server
npm run dev
```

The server will start on `http://localhost:3000`

## Configuration

### PDF URLs
Update the PDF URLs in your environment variables or directly in `server.js`:

```javascript
const PDF_URLS = {
  today: process.env.TODAY_PDF_URL || 'https://lgka.de/substitution-plans/today.pdf',
  tomorrow: process.env.TOMORROW_PDF_URL || 'https://lgka.de/substitution-plans/tomorrow.pdf'
};
```

### Update Frequency
The app checks for new substitute plans every 5 minutes. To change this, modify the cron schedule:

```javascript
// Every 5 minutes
cron.schedule('*/5 * * * *', updateSubstitutePlans);

// Every 10 minutes
cron.schedule('*/10 * * * *', updateSubstitutePlans);
```

## Class Name Formats

The backend supports various German class name formats:
- `9B`, `9b`, `9 B` → all normalized to `9b`
- `J11`, `j11`, `J 11` → all normalized to `j11`
- Case-insensitive matching
- Automatic space removal

## Error Handling

The API provides detailed error responses:

```json
{
  "error": {
    "message": "Failed to parse PDF",
    "timestamp": "2024-01-15T10:30:00.000Z"
  },
  "message": "Error fetching substitute plans"
}
```

## Monitoring

### Health Check
Railway uses `/api/health` for health monitoring:

```json
{
  "status": "healthy",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "uptime": 3600,
  "lastUpdated": "2024-01-15T10:25:00.000Z",
  "hasError": false
}
```

### Logs
View logs in the Railway dashboard or using Railway CLI:
```bash
railway logs
```

## Architecture

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│             │    │             │    │             │
│  LGKA App   │◄───┤   Railway   │◄───┤   School    │
│  (Flutter)  │    │   Backend   │    │   PDF URLs  │
│             │    │             │    │             │
└─────────────┘    └─────────────┘    └─────────────┘
```

## Support

For issues or questions:
1. Check Railway deployment logs
2. Verify PDF URLs are accessible
3. Test API endpoints manually
4. Check the `/api/health` endpoint

## License

Copyright Luka Löhr 2025 