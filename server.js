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

// Get all sports - NO LIMIT
app.get('/api/sports', ensureAuth, async (req, res) => {
    try {
        const response = await axios.get(`${BASE_URL}/datafeed/directories/api/v2/sports`, {
            params: { ref: REF, lng: req.query.lng || 'en' },
            headers: { Authorization: `Bearer ${req.authToken}` }
        });
        res.json(response.data);
    } catch (error) {
        res.status(error.response?.status || 500).json({ error: error.response?.data || error.message });
    }
});

// Get pre-match events - INCREASED LIMIT to 500
app.get('/api/prematch/events', ensureAuth, async (req, res) => {
    const { sportIds, tournamentIds, periods, types, vids } = req.query;
    try {
        let params = { 
            ref: REF, 
            lng: req.query.lng || 'en',
            count: 500  // Increased from default 100 to 500
        };
        if (sportIds) params.sportIds = sportIds;
        if (tournamentIds) params.tournamentIds = tournamentIds;
        if (periods) params.periods = periods;
        if (types) params.types = types;
        if (vids) params.vids = vids;
        
        const response = await axios.get(`${BASE_URL}/datafeed/prematch/api/v2/sportevents`, {
            params,
            headers: { Authorization: `Bearer ${req.authToken}` }
        });
        res.json(response.data);
    } catch (error) {
        res.status(error.response?.status || 500).json({ error: error.response?.data || error.message });
    }
});

// Get odds for specific sport events - NO LIMIT
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

// Get live events - INCREASED LIMIT
app.get('/api/live/events', ensureAuth, async (req, res) => {
    const { sportIds } = req.query;
    try {
        let params = { 
            ref: REF, 
            lng: req.query.lng || 'en',
            count: 200
        };
        if (sportIds) params.sportIds = sportIds;
        const response = await axios.get(`${BASE_URL}/datafeed/live/api/v2/sportevents`, {
            params,
            headers: { Authorization: `Bearer ${req.authToken}` }
        });
        res.json(response.data);
    } catch (error) {
        res.status(error.response?.status || 500).json({ error: error.response?.data || error.message });
    }
});

// Get results - EXPANDED DATE RANGE (max 48 hours as per API limits)
app.get('/api/results/sports', ensureAuth, async (req, res) => {
    const { dateFrom, dateTo } = req.query;
    if (!dateFrom || !dateTo) {
        return res.status(400).json({ error: 'dateFrom and dateTo required' });
    }
    try {
        const response = await axios.get(`${BASE_URL}/result/api/v1/sports`, {
            params: { ref: REF, dateFrom, dateTo, lng: req.query.lng || 'en' },
            headers: { Authorization: `Bearer ${req.authToken}` }
        });
        res.json(response.data);
    } catch (error) {
        res.status(error.response?.status || 500).json({ error: error.response?.data || error.message });
    }
});

// Get results by tournament
app.get('/api/results/by-tournament', ensureAuth, async (req, res) => {
    const { tournamentIds, dateFrom, dateTo } = req.query;
    if (!tournamentIds || !dateFrom || !dateTo) {
        return res.status(400).json({ error: 'tournamentIds, dateFrom, and dateTo required' });
    }
    try {
        const response = await axios.get(`${BASE_URL}/result/api/v1/sportevents`, {
            params: { ref: REF, tournamentIds, dateFrom, dateTo, lng: req.query.lng || 'en' },
            headers: { Authorization: `Bearer ${req.authToken}` }
        });
        res.json(response.data);
    } catch (error) {
        res.status(error.response?.status || 500).json({ error: error.response?.data || error.message });
    }
});

// Get actual sports (LoadTree) - NO LIMIT
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

// Get tournaments by sport ID - INCREASED LIMIT
app.get('/api/tree/tournaments', ensureAuth, async (req, res) => {
    const { sportId } = req.query;
    if (!sportId) {
        return res.status(400).json({ error: 'sportId required' });
    }
    try {
        let params = { 
            ref: REF, 
            sportId, 
            lng: req.query.lng || 'en',
            count: 500  // Get more tournaments
        };
        const response = await axios.get(`${BASE_URL}/datafeed/loadtree/prematch/api/v1/tournaments`, {
            params,
            headers: { Authorization: `Bearer ${req.authToken}` }
        });
        res.json(response.data);
    } catch (error) {
        res.status(error.response?.status || 500).json({ error: error.response?.data || error.message });
    }
});

// Get events by tournament ID
app.get('/api/tree/events', ensureAuth, async (req, res) => {
    const { tournamentId } = req.query;
    if (!tournamentId) {
        return res.status(400).json({ error: 'tournamentId required' });
    }
    try {
        const response = await axios.get(`${BASE_URL}/datafeed/loadtree/prematch/api/v1/sportEventIds`, {
            params: { ref: REF, tournamentId },
            headers: { Authorization: `Bearer ${req.authToken}` }
        });
        res.json(response.data);
    } catch (error) {
        res.status(error.response?.status || 500).json({ error: error.response?.data || error.message });
    }
});

// Get event details with markets
app.get('/api/tree/event-detail', ensureAuth, async (req, res) => {
    const { sportEventId, withSubGames } = req.query;
    if (!sportEventId) {
        return res.status(400).json({ error: 'sportEventId required' });
    }
    try {
        const response = await axios.get(`${BASE_URL}/datafeed/loadtree/prematch/api/v1/sporteventDetail`, {
            params: {
                ref: REF,
                sportEventId,
                withSubGames: withSubGames === 'true',
                schemeOfGettingOdds: 'GetAllOdds',
                lng: req.query.lng || 'en'
            },
            headers: { Authorization: `Bearer ${req.authToken}` }
        });
        res.json(response.data);
    } catch (error) {
        res.status(error.response?.status || 500).json({ error: error.response?.data || error.message });
    }
});

// Get H2H statistics
app.get('/api/statistics/h2h', ensureAuth, async (req, res) => {
    const { statEventId } = req.query;
    if (!statEventId) {
        return res.status(400).json({ error: 'statEventId required' });
    }
    try {
        const response = await axios.get(`https://cpservm.com/gateway/marketing/statistics/sportevent/h2h`, {
            params: { statEventId, ref: REF, lng: req.query.lng || 'en' },
            headers: { Authorization: `Bearer ${req.authToken}` }
        });
        res.json(response.data);
    } catch (error) {
        res.status(error.response?.status || 500).json({ error: error.response?.data || error.message });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📍 Maximum events per request: 500`);
});
