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
        // URL encode the client_id and client_secret to handle special characters
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

app.get('/api/prematch/events', ensureAuth, async (req, res) => {
    const { sportIds, tournamentIds } = req.query;
    try {
        let params = { ref: REF, lng: req.query.lng || 'en' };
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

app.get('/api/live/events', ensureAuth, async (req, res) => {
    const { sportIds } = req.query;
    try {
        let params = { ref: REF, lng: req.query.lng || 'en' };
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

app.get('/api/tree/tournaments', ensureAuth, async (req, res) => {
    const { sportId } = req.query;
    if (!sportId) {
        return res.status(400).json({ error: 'sportId required' });
    }
    try {
        const response = await axios.get(`${BASE_URL}/datafeed/loadtree/prematch/api/v1/tournaments`, {
            params: { ref: REF, sportId, lng: req.query.lng || 'en' },
            headers: { Authorization: `Bearer ${req.authToken}` }
        });
        res.json(response.data);
    } catch (error) {
        res.status(error.response?.status || 500).json({ error: error.response?.data || error.message });
    }
});

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

app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});
