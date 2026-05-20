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
const IMAGE_BASE_URL = 'https://cpservm.com';  // Base URL for images

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

// Proxy endpoint for team logos
app.get('/api/images/logo/:filename', async (req, res) => {
    const filename = req.params.filename;
    try {
        // Try multiple possible paths for the image
        const possiblePaths = [
            `${IMAGE_BASE_URL}/images/logo/${filename}`,
            `${IMAGE_BASE_URL}/sfiles/logo_teams/${filename}`,
            `${IMAGE_BASE_URL}/images/${filename}`,
            `${IMAGE_BASE_URL}/sfiles/${filename}`
        ];
        
        for (const imageUrl of possiblePaths) {
            try {
                const response = await axios.get(imageUrl, {
                    responseType: 'arraybuffer',
                    timeout: 10000,
                    headers: {
                        'User-Agent': 'Mozilla/5.0'
                    }
                });
                res.set('Content-Type', response.headers['content-type']);
                return res.send(response.data);
            } catch (e) {
                // Try next path
                continue;
            }
        }
        // If all paths fail, return a default placeholder
        res.status(404).send('Logo not found');
    } catch (error) {
        res.status(404).send('Logo not found');
    }
});

// Get all sports
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

// Get pre-match events - with logo URL fix
app.get('/api/prematch/events', ensureAuth, async (req, res) => {
    const { sportIds, tournamentIds } = req.query;
    try {
        let params = { 
            ref: REF, 
            lng: req.query.lng || 'en',
            count: 500
        };
        if (sportIds) params.sportIds = sportIds;
        if (tournamentIds) params.tournamentIds = tournamentIds;
        
        const response = await axios.get(`${BASE_URL}/datafeed/prematch/api/v2/sportevents`, {
            params,
            headers: { Authorization: `Bearer ${req.authToken}` }
        });
        
        // Fix image URLs - add full path
        if (response.data && response.data.items) {
            response.data.items.forEach(event => {
                if (event.imageOpponent1 && event.imageOpponent1.length) {
                    event.imageOpponent1 = event.imageOpponent1.map(img => 
                        `${req.protocol}://${req.get('host')}/api/images/logo/${img}`
                    );
                }
                if (event.imageOpponent2 && event.imageOpponent2.length) {
                    event.imageOpponent2 = event.imageOpponent2.map(img => 
                        `${req.protocol}://${req.get('host')}/api/images/logo/${img}`
                    );
                }
                if (event.tournamentImage && event.tournamentImage.length) {
                    event.tournamentImage = event.tournamentImage.map(img => 
                        `${req.protocol}://${req.get('host')}/api/images/logo/${img}`
                    );
                }
            });
        }
        res.json(response.data);
    } catch (error) {
        res.status(error.response?.status || 500).json({ error: error.response?.data || error.message });
    }
});

// Get odds for specific sport events
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

// Get live events - with logo URL fix
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
        
        // Fix image URLs
        if (response.data && response.data.items) {
            response.data.items.forEach(event => {
                if (event.imageOpponent1 && event.imageOpponent1.length) {
                    event.imageOpponent1 = event.imageOpponent1.map(img => 
                        `${req.protocol}://${req.get('host')}/api/images/logo/${img}`
                    );
                }
                if (event.imageOpponent2 && event.imageOpponent2.length) {
                    event.imageOpponent2 = event.imageOpponent2.map(img => 
                        `${req.protocol}://${req.get('host')}/api/images/logo/${img}`
                    );
                }
            });
        }
        res.json(response.data);
    } catch (error) {
        res.status(error.response?.status || 500).json({ error: error.response?.data || error.message });
    }
});

// Get results (ended games)
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

// Get previous games results by tournament
app.get('/api/results/previous', ensureAuth, async (req, res) => {
    const { tournamentId, daysBack } = req.query;
    const dateTo = Math.floor(Date.now() / 1000);
    const dateFrom = dateTo - (parseInt(daysBack) || 7) * 86400;
    
    try {
        const response = await axios.get(`${BASE_URL}/result/api/v1/sportevents`, {
            params: { ref: REF, tournamentIds: tournamentId, dateFrom, dateTo, lng: req.query.lng || 'en' },
            headers: { Authorization: `Bearer ${req.authToken}` }
        });
        res.json(response.data);
    } catch (error) {
        res.status(error.response?.status || 500).json({ error: error.response?.data || error.message });
    }
});

// Get actual sports (LoadTree)
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

// Get tournaments by sport ID
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
            count: 500
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

// Get event details with markets and subGames
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
        const response = await axios.get(`${BASE_URL}/statistics/sportevent/h2h`, {
            params: { statEventId, ref: REF, lng: req.query.lng || 'en', gr: 0, cnt: 0 },
            headers: { Authorization: `Bearer ${req.authToken}` }
        });
        res.json(response.data);
    } catch (error) {
        res.status(error.response?.status || 500).json({ error: error.response?.data || error.message });
    }
});

// Get overall game statistics
app.get('/api/statistics/game', ensureAuth, async (req, res) => {
    const { statEventId } = req.query;
    if (!statEventId) {
        return res.status(400).json({ error: 'statEventId required' });
    }
    try {
        const response = await axios.get(`${BASE_URL}/statistics/sportevent/game`, {
            params: { statEventId, ref: REF, lng: req.query.lng || 'en', gr: 0, cnt: 0 },
            headers: { Authorization: `Bearer ${req.authToken}` }
        });
        res.json(response.data);
    } catch (error) {
        res.status(error.response?.status || 500).json({ error: error.response?.data || error.message });
    }
});

// Get stage statistics
app.get('/api/statistics/stage', ensureAuth, async (req, res) => {
    const { statEventId } = req.query;
    if (!statEventId) {
        return res.status(400).json({ error: 'statEventId required' });
    }
    try {
        const response = await axios.get(`${BASE_URL}/statistics/sportevent/stage`, {
            params: { statEventId, ref: REF, lng: req.query.lng || 'en', gr: 0, cnt: 0 },
            headers: { Authorization: `Bearer ${req.authToken}` }
        });
        res.json(response.data);
    } catch (error) {
        res.status(error.response?.status || 500).json({ error: error.response?.data || error.message });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📍 Logo proxy: /api/images/logo/:filename`);
});
