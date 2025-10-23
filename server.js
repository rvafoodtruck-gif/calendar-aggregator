// Backend Server for Calendar Aggregator (Node.js)
// This provides better security and performance for 50+ calendars

const express = require('express');
const { google } = require('googleapis');
const cors = require('cors');
const NodeCache = require('node-cache');

const app = express();
const PORT = process.env.PORT || 3000;

// Cache calendar data for 5 minutes to reduce API calls
const cache = new NodeCache({ stdTTL: 300 });

// Enable CORS for your Squarespace domain
app.use(cors({
    origin: ['https://your-squarespace-site.com', 'http://localhost:3000']
}));

// ===========================================
// CONFIGURATION
// ===========================================

const CONFIG = {
    // Your Google Calendar API key
    apiKey: process.env.GOOGLE_API_KEY || 'YOUR_GOOGLE_API_KEY',
    
    // Calendar configurations
    calendars: [
        {
        id: 'en.usa#holiday@group.v.calendar.google.com',
        name: 'US Holidays Test',
        color: '#4285f4'
        }
    ],
    
    daysToShow: 30,
    maxResults: 50
};

// ===========================================
// API ENDPOINTS
// ===========================================

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Get all calendar events
app.get('/api/events', async (req, res) => {
    try {
        const { person, date, days } = req.query;
        const cacheKey = `events_${person || 'all'}_${date || 'all'}_${days || CONFIG.daysToShow}`;
        
        // Check cache first
        const cachedData = cache.get(cacheKey);
        if (cachedData) {
            return res.json(cachedData);
        }

        // Calculate date range
        const daysToShow = parseInt(days) || CONFIG.daysToShow;
        const timeMin = new Date().toISOString();
        const timeMax = new Date(Date.now() + daysToShow * 24 * 60 * 60 * 1000).toISOString();

        // Filter calendars if person is specified
        let calendarsToFetch = CONFIG.calendars;
        if (person) {
            calendarsToFetch = CONFIG.calendars.filter(cal => cal.id === person);
        }

        // Fetch from all calendars
        const calendar = google.calendar({ version: 'v3', auth: CONFIG.apiKey });
        
        const promises = calendarsToFetch.map(async (cal) => {
            try {
                const response = await calendar.events.list({
                    calendarId: cal.id,
                    timeMin: timeMin,
                    timeMax: timeMax,
                    maxResults: CONFIG.maxResults,
                    singleEvents: true,
                    orderBy: 'startTime'
                });

                return (response.data.items || []).map(event => ({
                    title: event.summary || 'Untitled Event',
                    start: event.start.dateTime || event.start.date,
                    end: event.end.dateTime || event.end.date,
                    description: event.description || '',
                    location: event.location || '',
                    person: cal.name,
                    personId: cal.id,
                    color: cal.color,
                    allDay: !event.start.dateTime
                }));
            } catch (error) {
                console.error(`Error fetching calendar ${cal.name}:`, error.message);
                return [];
            }
        });

        const results = await Promise.all(promises);
        const allEvents = results.flat();
        
        // Sort by start time
        allEvents.sort((a, b) => new Date(a.start) - new Date(b.start));

        // Filter by date if specified
        let filteredEvents = allEvents;
        if (date) {
            filteredEvents = allEvents.filter(event => 
                event.start.startsWith(date)
            );
        }

        const responseData = {
            events: filteredEvents,
            totalEvents: filteredEvents.length,
            totalCalendars: calendarsToFetch.length,
            cached: false,
            timestamp: new Date().toISOString()
        };

        // Cache the results
        cache.set(cacheKey, responseData);

        res.json(responseData);

    } catch (error) {
        console.error('Error fetching events:', error);
        res.status(500).json({ 
            error: 'Failed to fetch calendar events',
            message: error.message 
        });
    }
});

// Get list of all people/calendars
app.get('/api/people', (req, res) => {
    const people = CONFIG.calendars.map(cal => ({
        id: cal.id,
        name: cal.name,
        color: cal.color
    }));
    
    res.json({ people });
});

// Get statistics
app.get('/api/stats', async (req, res) => {
    try {
        const cacheKey = 'stats';
        const cachedStats = cache.get(cacheKey);
        
        if (cachedStats) {
            return res.json(cachedStats);
        }

        // Fetch events for statistics
        const timeMin = new Date().toISOString();
        const timeMax = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
        const weekFromNow = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

        const calendar = google.calendar({ version: 'v3', auth: CONFIG.apiKey });
        
        const promises = CONFIG.calendars.map(async (cal) => {
            try {
                const response = await calendar.events.list({
                    calendarId: cal.id,
                    timeMin: timeMin,
                    timeMax: timeMax,
                    maxResults: CONFIG.maxResults,
                    singleEvents: true
                });
                return response.data.items || [];
            } catch (error) {
                return [];
            }
        });

        const results = await Promise.all(promises);
        const allEvents = results.flat();
        
        const upcomingWeek = allEvents.filter(event => {
            const start = new Date(event.start.dateTime || event.start.date);
            return start <= weekFromNow;
        });

        const stats = {
            totalEvents: allEvents.length,
            totalPeople: CONFIG.calendars.length,
            upcomingWeek: upcomingWeek.length,
            timestamp: new Date().toISOString()
        };

        cache.set(cacheKey, stats);
        res.json(stats);

    } catch (error) {
        console.error('Error fetching stats:', error);
        res.status(500).json({ error: 'Failed to fetch statistics' });
    }
});

// Clear cache endpoint (optional, for admin use)
app.post('/api/cache/clear', (req, res) => {
    cache.flushAll();
    res.json({ message: 'Cache cleared successfully' });
});

// ===========================================
// START SERVER
// ===========================================

app.listen(PORT, () => {
    console.log(`Calendar Aggregator Server running on port ${PORT}`);
    console.log(`Configured with ${CONFIG.calendars.length} calendars`);
    console.log(`API endpoints:`);
    console.log(`  - GET  /api/events`);
    console.log(`  - GET  /api/people`);
    console.log(`  - GET  /api/stats`);
    console.log(`  - POST /api/cache/clear`);
});

module.exports = app;
