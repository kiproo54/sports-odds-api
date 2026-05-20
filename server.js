import express from 'express';
import axios from 'axios';
import cors from 'cors';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const REF = process.env.REF;
const TOKEN_URL = 'https://cpservm.com/gateway/token';
const BASE_URL = 'https://cpservm.com/gateway/marketing';

let currentAccessToken = null;
let tokenExpiryTime = 0;

async function getAccessToken() {
    console.log('🔄 Getting access token...');
    try {
        const encodedClientId = encodeURIComponent(CLIENT_ID);
        const encodedClientSecret = encodeURIComponent(CLIENT_SECRET);
        
        const response = await axios.post(TOKEN_URL, 
            `client_id=${encodedClientId}&client_secret=${encodedClientSecret}`,
            { 
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                timeout: 30000
            }
        );
        currentAccessToken = response.data.access_token;
        tokenExpiryTime = Date.now() + (response.data.expires_in - 60) * 1000;
        console.log('✅ Token obtained successfully');
        return currentAccessToken;
    } catch (error) {
        console.error('❌ Token error:', error.response?.data || error.message);
        throw error;
    }
}

async function getValidToken() {
    if (!currentAccessToken || Date.now() >= tokenExpiryTime) {
        await getAccessToken();
    }
    return currentAccessToken;
}

async function ensureAuth(req, res, next) {
    try {
        req.authToken = await getValidToken();
        next();
    } catch (error) {
        res.status(500).json({ error: 'Auth failed', details: error.message });
    }
}

app.get('/', (req, res) => {
    res.json({ status: 'running', message: 'Sports API Proxy is working!' });
});

// ============ GET TODAY'S MATCHES ============
app.get('/api/matches/today', ensureAuth, async (req, res) => {
    try {
        // Get today's date range (UTC)
        const now = new Date();
        const todayStart = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
        const todayEnd = new Date(todayStart);
        todayEnd.setUTCDate(todayEnd.getUTCDate() + 1);
        
        const startTimestamp = Math.floor(todayStart.getTime() / 1000);
        const endTimestamp = Math.floor(todayEnd.getTime() / 1000);
        
        const response = await axios.get(`${BASE_URL}/datafeed/prematch/api/v2/sportevents`, {
            params: {
                ref: REF,
                lng: 'en',
                sportIds: 1,
                count: 200
            },
            headers: { Authorization: `Bearer ${req.authToken}` }
        });
        
        const allEvents = response.data.items || [];
        const todayEvents = allEvents.filter(event => 
            event.startDate >= startTimestamp && event.startDate < endTimestamp
        );
        
        res.json({
            date: todayStart.toISOString().split('T')[0],
            count: todayEvents.length,
            items: todayEvents
        });
    } catch (error) {
        res.status(error.response?.status || 500).json({ error: error.response?.data || error.message });
    }
});

// ============ GET TOMORROW'S MATCHES ============
app.get('/api/matches/tomorrow', ensureAuth, async (req, res) => {
    try {
        const now = new Date();
        const tomorrowStart = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate() + 1));
        const tomorrowEnd = new Date(tomorrowStart);
        tomorrowEnd.setUTCDate(tomorrowEnd.getUTCDate() + 1);
        
        const startTimestamp = Math.floor(tomorrowStart.getTime() / 1000);
        const endTimestamp = Math.floor(tomorrowEnd.getTime() / 1000);
        
        const response = await axios.get(`${BASE_URL}/datafeed/prematch/api/v2/sportevents`, {
            params: {
                ref: REF,
                lng: 'en',
                sportIds: 1,
                count: 200
            },
            headers: { Authorization: `Bearer ${req.authToken}` }
        });
        
        const allEvents = response.data.items || [];
        const tomorrowEvents = allEvents.filter(event => 
            event.startDate >= startTimestamp && event.startDate < endTimestamp
        );
        
        res.json({
            date: tomorrowStart.toISOString().split('T')[0],
            count: tomorrowEvents.length,
            items: tomorrowEvents
        });
    } catch (error) {
        res.status(error.response?.status || 500).json({ error: error.response?.data || error.message });
    }
});

// ============ GET ODDS FOR A MATCH ============
app.get('/api/odds/:eventId', ensureAuth, async (req, res) => {
    const { eventId } = req.params;
    try {
        const response = await axios.get(`${BASE_URL}/datafeed/prematch/api/v2/sportevents`, {
            params: {
                ref: REF,
                lng: 'en',
                schemeOfGettingOddsOperations: 'GetAllOdds',
                sportEventIds: eventId
            },
            headers: { Authorization: `Bearer ${req.authToken}` }
        });
        res.json(response.data);
    } catch (error) {
        res.status(error.response?.status || 500).json({ error: error.response?.data || error.message });
    }
});

// ============ GET MATCH RESULT ============
app.get('/api/result/:eventId', ensureAuth, async (req, res) => {
    const { eventId } = req.params;
    try {
        const response = await axios.get(`${BASE_URL}/result/api/v1/sportevent`, {
            params: {
                ref: REF,
                lng: 'en',
                sportEventIds: eventId
            },
            headers: { Authorization: `Bearer ${req.authToken}` }
        });
        res.json(response.data);
    } catch (error) {
        res.status(error.response?.status || 500).json({ error: error.response?.data || error.message });
    }
});

// Keep original endpoints for backward compatibility
app.get('/api/prematch/events', ensureAuth, async (req, res) => {
    const { sportIds, tournamentIds } = req.query;
    try {
        let params = { ref: REF, lng: req.query.lng || 'en', count: 500 };
        if (sportIds) params.sportIds = sportIds;
        if (tournamentIds) params.tournamentIds = tournamentIds;
        const response = await axios.get(`${BASE_URL}/datafeed/prematch/api/v2/sportevents`, {
            params,
            headers: { Authorization: `Bearer ${req.authToken}` }
        });
        res.json(response.data);
    } catch (error) {
        res.status(error.response?.status || 500).json({ error: error.response?.data || error.message });
    }
});

app.get('/api/prematch/odds', ensureAuth, async (req, res) => {
    const { sportEventIds } = req.query;
    if (!sportEventIds) {
        return res.status(400).json({ error: 'sportEventIds required' });
    }
    try {
        const response = await axios.get(`${BASE_URL}/datafeed/prematch/api/v2/sportevents`, {
            params: {
                ref: REF,
                lng: req.query.lng || 'en',
                schemeOfGettingOddsOperations: 'GetAllOdds',
                sportEventIds: sportEventIds
            },
            headers: { Authorization: `Bearer ${req.authToken}` }
        });
        res.json(response.data);
    } catch (error) {
        res.status(error.response?.status || 500).json({ error: error.response?.data || error.message });
    }
});

app.get('/api/results/sportevent', ensureAuth, async (req, res) => {
    const { sportEventIds } = req.query;
    if (!sportEventIds) {
        return res.status(400).json({ error: 'sportEventIds required' });
    }
    try {
        const response = await axios.get(`${BASE_URL}/result/api/v1/sportevent`, {
            params: { ref: REF, lng: req.query.lng || 'en', sportEventIds },
            headers: { Authorization: `Bearer ${req.authToken}` }
        });
        res.json(response.data);
    } catch (error) {
        res.status(error.response?.status || 500).json({ error: error.response?.data || error.message });
    }
});

app.get('/api/tree/sports', ensureAuth, async (req, res) => {
    try {
        const response = await axios.get(`${BASE_URL}/datafeed/loadtree/prematch/api/v1/sportList`, {
            params: { ref: REF },
            headers: { Authorization: `Bearer ${req.authToken}` }
        });
        res.json(response.data);
    } catch (error) {
        res.status(error.response?.status || 500).json({ error: error.response?.data || error.message });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📅 Today matches: /api/matches/today`);
    console.log(`⏩ Tomorrow matches: /api/matches/tomorrow`);
    console.log(`🎯 Odds: /api/odds/:eventId`);
    console.log(`📊 Result: /api/result/:eventId`);
});
