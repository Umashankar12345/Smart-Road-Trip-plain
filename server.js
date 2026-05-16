const express = require('express');
const path = require('path');
const compression = require('compression');
const helmet = require('helmet');
const cors = require('cors');
const fs = require('fs');
require('dotenv').config();

const authRoutes = require('./routes/auth');
const tripRoutes = require('./routes/trips');

const app = express();
const PORT = process.env.PORT || 4000;

app.use(express.json());

// Security middleware with updated CSP configuration for APIs
app.use(helmet({
  contentSecurityPolicy: false // Disable CSP for development to avoid API issues
}));

// Enable CORS with specific configuration
app.use(cors({
  origin: '*', // Allow all origins
  methods: ['GET', 'POST'], // Allow these methods
  allowedHeaders: ['Content-Type', 'Authorization'] // Allow these headers
}));

// Compress all responses
app.use(compression());

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/trips', tripRoutes);

// Environment variables for frontend
const ENV_VARS = {
  ORS_API_KEY: process.env.ORS_API_KEY || '',
  MAPBOX_ACCESS_TOKEN: process.env.MAPBOX_ACCESS_TOKEN || '',
  UNSPLASH_ACCESS_KEY: process.env.UNSPLASH_ACCESS_KEY || '',
  GROQ_API_KEY: process.env.GROQ_API_KEY || ''
};

// Trip cost estimation via Groq AI (secure — key stays on server)
app.post('/api/costs', async (req, res) => {
  try {
    const { distanceKm, durationHours, startAddress, endAddress } = req.body;

    if (!process.env.GROQ_API_KEY) {
      return res.json({ error: 'Groq API key not configured' });
    }

    const prompt = `Calculate the following for a road trip from ${startAddress} to ${endAddress} (distance: ${Number(distanceKm).toFixed(1)} km, duration: ${Number(durationHours).toFixed(1)} hours).
Reply with ONLY a valid JSON object — no markdown, no code block, no explanation:
{
  "fuelCost": "estimated cost with currency symbol",
  "restStops": <number>,
  "tollCost": "estimated cost or None"
}`;

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama3-8b-8192',
        messages: [
          { role: 'system', content: 'You are a road trip cost estimator. Always respond with valid JSON only.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.2,
        max_tokens: 200
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('[COSTS] Groq error:', response.status, errText);
      return res.json({ error: `Groq returned ${response.status}` });
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    console.log('[COSTS] Groq response:', content);

    // Strip markdown code fences if present
    const cleaned = content.replace(/```json?/g, '').replace(/```/g, '').trim();
    const tripData = JSON.parse(cleaned);
    res.json(tripData);
  } catch (error) {
    console.error('[COSTS] ERROR:', error.message);
    res.json({ error: 'Failed to calculate costs' });
  }
});

// POI Proxy route — uses Overpass API (OpenStreetMap), no API key needed
app.post('/api/pois', async (req, res) => {
  try {
    const { coordinates, categories } = req.body;

    // Validate input
    if (!coordinates || !Array.isArray(coordinates) || coordinates.length < 2) {
      return res.json([]);
    }
    if (!categories || !Array.isArray(categories) || categories.length === 0) {
      return res.json([]);
    }

    const [lon, lat] = coordinates;

    // Map our category names to OSM tags
    const osmTagMap = {
      fuel: `node["amenity"="fuel"]`,
      restaurant: `node["amenity"="restaurant"]`,
      hotel: `node["tourism"="hotel"]`,
      attraction: `node["tourism"~"attraction|museum|viewpoint|theme_park"]`
    };

    const category = categories[0];
    const osmTag = osmTagMap[category] || `node["amenity"="${category}"]`;

    // Overpass QL query — 5km radius, limit 5 results
    const query = `[out:json][timeout:10];${osmTag}(around:5000,${lat},${lon});out 5;`;

    console.log(`[POI] Overpass query for "${category}" near [${lat},${lon}]`);

    const response = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `data=${encodeURIComponent(query)}`
    });

    if (!response.ok) {
      console.error(`[POI] Overpass returned HTTP ${response.status}`);
      return res.json([]);
    }

    const data = await response.json();
    const elements = Array.isArray(data.elements) ? data.elements : [];
    console.log(`[POI] Overpass returned ${elements.length} results`);

    // Normalize to GeoJSON feature format expected by frontend
    const features = elements
      .filter(el => el.lat != null && el.lon != null)
      .map(el => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [el.lon, el.lat] },
        properties: {
          name: el.tags?.name || el.tags?.amenity || el.tags?.tourism || 'Unknown',
          osm_id: String(el.id),
          category: category
        }
      }));

    res.json(features);
  } catch (error) {
    console.error('[POI] ERROR:', error.message);
    res.json([]); // Always return array — never 500
  }
});

// Chatbot assistant via Groq AI (secure — key stays on server)
app.post('/api/chat', async (req, res) => {
  try {
    const { message, systemPrompt, temperature, maxTokens } = req.body;

    if (!process.env.GROQ_API_KEY) {
      return res.json({ error: 'Groq API key not configured' });
    }

    console.log(`[CHAT] Request received: "${message.substring(0, 100)}${message.length > 100 ? '...' : ''}"`);
    console.log('[CHAT] System Prompt:', (systemPrompt || 'Default').substring(0, 50));

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama3-8b-8192',
        messages: [
          { role: 'system', content: systemPrompt || 'You are a helpful travel assistant.' },
          { role: 'user', content: message }
        ],
        temperature: temperature || 0.7,
        max_tokens: maxTokens || 500
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('[CHAT] Groq error:', response.status, errText);
      return res.status(response.status).json({ error: `Groq returned ${response.status}` });
    }

    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('[CHAT] ERROR:', error.message);
    res.status(500).json({ error: 'Failed to process chat message' });
  }
});


// Middleware to inject environment variables into HTML
app.use((req, res, next) => {
  // Only intercept HTML requests
  if (req.path.endsWith('.html') || req.path === '/' || req.path === '') {
    const filePath = path.join(__dirname, 'public', req.path === '/' || req.path === '' ? 'index.html' : req.path);

    fs.readFile(filePath, 'utf8', (err, data) => {
      if (err) {
        return next(); // Continue to static file serving if file not found
      }

      // Replace placeholders with actual values
      let modifiedHtml = data;
      Object.keys(ENV_VARS).forEach(key => {
        modifiedHtml = modifiedHtml.replace(
          new RegExp(`%%${key}%%`, 'g'),
          ENV_VARS[key]
        );
      });

      res.send(modifiedHtml);
    });
  } else {
    next();
  }
});

// Serve static files from the public directory
app.use(express.static(path.join(__dirname, 'public')));

// Serve index.html for all other routes for SPA capability
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start the server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`Visit http://localhost:${PORT} to view the application`);

  // Log environment status
  console.log('\nEnvironment variables:');
  console.log(`- ORS_API_KEY: ${ENV_VARS.ORS_API_KEY ? '✅ Set' : '❌ Not set'}`);
  console.log(`- MAPBOX_ACCESS_TOKEN: ${ENV_VARS.MAPBOX_ACCESS_TOKEN ? '✅ Set' : '❌ Not set'}`);
  console.log(`- UNSPLASH_ACCESS_KEY: ${ENV_VARS.UNSPLASH_ACCESS_KEY ? '✅ Set' : '❌ Not set'}`);
  console.log(`- GROQ_API_KEY: ${ENV_VARS.GROQ_API_KEY ? '✅ Set' : '❌ Not set'}`);
}); 