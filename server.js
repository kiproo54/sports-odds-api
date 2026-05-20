import express from 'express';
import axios from 'axios';
import cors from 'cors';
import cron from 'node-cron';

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

// Category configuration
const CATEGORIES = {
    btts: { market: 'btts', minOdds: 1.19, maxOdds: 1.70, minTips: 2, maxTips: 4, exactTips: null },
    overunder: { market: 'overunder', minOdds: 1.19, maxOdds: 1.70, minTips: 2, maxTips: 4, exactTips: null },
    htft: { market: 'htft', minOdds: null, maxOdds: null, minTips: 2, maxTips: 2, exactTips: 2, smallestOdds: true },
    correctscores: { market: 'correctscores', minOdds: null, maxOdds: null, minTips: 2, maxTips: 2, exactTips: 2, smallestOdds: true },
    cstwo: { market: 'any', minOdds: 1.19, maxOdds: 1.70, minTips: 2, maxTips: 4, exactTips: null },
    twoplus: { market: 'any', minOdds: 1.19, maxOdds: 1.70, minTips: 2, maxTips: 4, exactTips: null },
    viptwo: { market: 'any', minOdds: 1.19, maxOdds: 1.70, minTips: 2, maxTips: 4, exactTips: null },
    fiveplus: { market: 'any', minOdds: 1.19, maxOdds: 1.70, minTips: 2, maxTips: 4, exactTips: null },
    tenplus: { market: 'any', minOdds: 1.19, maxOdds: 1.70, minTips: 2, maxTips: 4, exactTips: null },
    freetips: { market: 'any', minOdds: 1.19, maxOdds: 1.70, minTips: 2, maxTips: 4, exactTips: null }
};

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

// ============ AUTO-TIP GENERATOR ============
async function fetchMatches(dateRange) {
    try {
        const response = await axios.get(`${BASE_URL}/datafeed/prematch/api/v2/sportevents`, {
            params: { ref: REF, lng: 'en', sportIds: 1, count: 200 },
            headers: { Authorization: `Bearer ${await getValidToken()}` }
        });
        const allMatches = response.data.items || [];
        return allMatches.filter(m => m.startDate >= dateRange.start && m.startDate < dateRange.end);
    } catch (error) {
        console.error('Error fetching matches:', error);
        return [];
    }
}

async function fetchOddsForMatch(eventId) {
    try {
        const response = await axios.get(`${BASE_URL}/datafeed/prematch/api/v2/sportevents`, {
            params: { ref: REF, lng: 'en', schemeOfGettingOddsOperations: 'GetAllOdds', sportEventIds: eventId },
            headers: { Authorization: `Bearer ${await getValidToken()}` }
        });
        return response.data.items?.[0]?.oddsLocalization || [];
    } catch (error) {
        return [];
    }
}

function getOddsByType(oddsList, type, subType = null) {
    if (type === 'btts') {
        return oddsList.find(o => o.type === 180);
    }
    if (type === 'overunder') {
        const over25 = oddsList.find(o => o.type === 9 && Math.abs(o.parameter - 2.5) < 0.01);
        const under25 = oddsList.find(o => o.type === 10 && Math.abs(o.parameter - 2.5) < 0.01);
        return over25 || under25;
    }
    if (type === 'htft') {
        const htftOptions = oddsList.filter(o => o.type >= 15 && o.type <= 23);
        if (htftOptions.length) {
            return htftOptions.reduce((min, o) => (o.oddsMarket < min.oddsMarket ? o : min), htftOptions[0]);
        }
        return null;
    }
    if (type === 'correctscores') {
        const csOptions = oddsList.filter(o => o.type === 731 && o.oddsMarket < 30);
        if (csOptions.length) {
            return csOptions.reduce((min, o) => (o.oddsMarket < min.oddsMarket ? o : min), csOptions[0]);
        }
        return null;
    }
    return null;
}

function getAnyOddsInRange(oddsList, minOdds, maxOdds) {
    const validOdds = oddsList.filter(o => 
        o.oddsMarket >= minOdds && o.oddsMarket <= maxOdds && 
        ![2, 180, 181, 731].includes(o.type) // exclude draw, BTTS, correct score from any category
    );
    if (validOdds.length) {
        return validOdds[0];
    }
    return null;
}

async function generateTipsForTomorrow() {
    console.log('🌙 Starting midnight tip generation...');
    
    // Get tomorrow's date range
    const now = new Date();
    const tomorrow = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate() + 1));
    const tomorrowStart = Math.floor(tomorrow.getTime() / 1000);
    const tomorrowEnd = tomorrowStart + 86400;
    
    const matches = await fetchMatches({ start: tomorrowStart, end: tomorrowEnd });
    console.log(`📊 Found ${matches.length} matches for tomorrow`);
    
    if (matches.length === 0) {
        console.log('⚠️ No matches found for tomorrow');
        return;
    }
    
    // Fetch odds for all matches
    const matchesWithOdds = [];
    for (const match of matches) {
        const odds = await fetchOddsForMatch(match.sportEventId);
        matchesWithOdds.push({ ...match, odds });
        await new Promise(r => setTimeout(r, 100));
    }
    
    const tips = {};
    
    // Generate tips for each category
    for (const [catName, config] of Object.entries(CATEGORIES)) {
        tips[catName] = [];
        const targetCount = config.exactTips || Math.floor(Math.random() * (config.maxTips - config.minTips + 1)) + config.minTips;
        
        if (config.smallestOdds) {
            // For HT/FT and Correct Scores - pick smallest odds available
            const allTips = [];
            for (const match of matchesWithOdds) {
                const odd = getOddsByType(match.odds, config.market);
                if (odd && odd.oddsMarket) {
                    allTips.push({
                        match: `${match.opponent1NameLocalization} vs ${match.opponent2NameLocalization}`,
                        league: match.tournamentNameLocalization,
                        tip: odd.display || (config.market === 'htft' ? 'HT/FT' : 'Correct Score'),
                        odds: odd.oddsMarket.toFixed(2),
                        eventId: match.sportEventId,
                        date: new Date(match.startDate * 1000).toISOString().split('T')[0],
                        time: new Date(match.startDate * 1000).toTimeString().slice(0, 5),
                        status: '🟡 Pending',
                        results: '-'
                    });
                }
            }
            // Sort by odds ascending and pick smallest
            allTips.sort((a, b) => parseFloat(a.odds) - parseFloat(b.odds));
            tips[catName] = allTips.slice(0, targetCount);
        } 
        else if (config.market === 'btts') {
            // BTTS specific
            const bttsTips = [];
            for (const match of matchesWithOdds) {
                const odd = getOddsByType(match.odds, 'btts');
                if (odd && odd.oddsMarket >= config.minOdds && odd.oddsMarket <= config.maxOdds) {
                    bttsTips.push({
                        match: `${match.opponent1NameLocalization} vs ${match.opponent2NameLocalization}`,
                        league: match.tournamentNameLocalization,
                        tip: odd.display || 'BTTS Yes',
                        odds: odd.oddsMarket.toFixed(2),
                        eventId: match.sportEventId,
                        date: new Date(match.startDate * 1000).toISOString().split('T')[0],
                        time: new Date(match.startDate * 1000).toTimeString().slice(0, 5),
                        status: '🟡 Pending',
                        results: '-'
                    });
                }
            }
            // Randomly pick tips within range
            const shuffled = bttsTips.sort(() => 0.5 - Math.random());
            tips[catName] = shuffled.slice(0, targetCount);
        }
        else if (config.market === 'overunder') {
            // Over/Under specific
            const ouTips = [];
            for (const match of matchesWithOdds) {
                const odd = getOddsByType(match.odds, 'overunder');
                if (odd && odd.oddsMarket >= config.minOdds && odd.oddsMarket <= config.maxOdds) {
                    ouTips.push({
                        match: `${match.opponent1NameLocalization} vs ${match.opponent2NameLocalization}`,
                        league: match.tournamentNameLocalization,
                        tip: odd.display || (odd.type === 9 ? `Over ${odd.parameter}` : `Under ${odd.parameter}`),
                        odds: odd.oddsMarket.toFixed(2),
                        eventId: match.sportEventId,
                        date: new Date(match.startDate * 1000).toISOString().split('T')[0],
                        time: new Date(match.startDate * 1000).toTimeString().slice(0, 5),
                        status: '🟡 Pending',
                        results: '-'
                    });
                }
            }
            const shuffled = ouTips.sort(() => 0.5 - Math.random());
            tips[catName] = shuffled.slice(0, targetCount);
        }
        else {
            // Any market (CSTWO, TwoPlus, VIPTwo, FivePlus, TenPlus, FreeTips)
            const anyTips = [];
            for (const match of matchesWithOdds) {
                const odd = getAnyOddsInRange(match.odds, config.minOdds, config.maxOdds);
                if (odd) {
                    anyTips.push({
                        match: `${match.opponent1NameLocalization} vs ${match.opponent2NameLocalization}`,
                        league: match.tournamentNameLocalization,
                        tip: odd.display || `Market ${odd.type}`,
                        odds: odd.oddsMarket.toFixed(2),
                        eventId: match.sportEventId,
                        date: new Date(match.startDate * 1000).toISOString().split('T')[0],
                        time: new Date(match.startDate * 1000).toTimeString().slice(0, 5),
                        status: '🟡 Pending',
                        results: '-'
                    });
                }
            }
            const shuffled = anyTips.sort(() => 0.5 - Math.random());
            tips[catName] = shuffled.slice(0, targetCount);
        }
        
        console.log(`📁 ${catName}: generated ${tips[catName].length} tips`);
    }
    
    console.log('✅ Tip generation complete!');
    return tips;
}

// ============ UPDATE RESULTS FOR PAST GAMES ============
async function updateResults(category, predictions) {
    let updated = false;
    for (let i = 0; i < predictions.length; i++) {
        const pred = predictions[i];
        if (pred.status !== '🟡 Pending') continue;
        
        try {
            const response = await axios.get(`${BASE_URL}/result/api/v1/sportevent`, {
                params: { ref: REF, lng: 'en', sportEventIds: pred.eventId },
                headers: { Authorization: `Bearer ${await getValidToken()}` }
            });
            const result = response.data.items?.[0];
            if (result && result.score) {
                pred.results = result.score;
                // Determine if tip won or lost (simplified - admin can adjust)
                pred.status = '🟢 Won'; // Default to Won, admin can change
                updated = true;
                console.log(`📊 Updated ${pred.match}: ${result.score}`);
            }
        } catch (error) {
            // No result yet
        }
        await new Promise(r => setTimeout(r, 100));
    }
    return updated;
}

// ============ MIDNIGHT CRON JOB ============
async function midnightAutomation() {
    console.log('========================================');
    console.log('🌙 MIDNIGHT AUTOMATION STARTED');
    console.log(`⏰ Time: ${new Date().toISOString()}`);
    console.log('========================================');
    
    try {
        // Generate new tips for tomorrow
        const newTips = await generateTipsForTomorrow();
        
        // Here you would save to your Firebase
        // This depends on your Firebase structure
        console.log('📝 Tips ready to save to Firebase');
        
        console.log('========================================');
        console.log('✅ MIDNIGHT AUTOMATION COMPLETED');
        console.log('========================================');
        
    } catch (error) {
        console.error('❌ Midnight automation failed:', error);
    }
}

// Schedule cron job - runs at midnight (00:00) UTC
// 0 0 * * * = every day at midnight UTC (3 AM Kenya time)
cron.schedule('0 0 * * *', () => {
    midnightAutomation();
}, {
    scheduled: true,
    timezone: "UTC"
});

console.log('⏰ Cron job scheduled: Daily at midnight UTC');

// ============ API ENDPOINTS ============

app.get('/', (req, res) => {
    res.json({ 
        status: 'running', 
        message: 'Sports API Proxy is working!',
        automation: 'Daily at midnight UTC',
        categories: Object.keys(CATEGORIES)
    });
});

// Manual trigger for testing
app.get('/api/manual-generate', ensureAuth, async (req, res) => {
    const tips = await generateTipsForTomorrow();
    res.json({ success: true, tips });
});

// Get pre-match events
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

// Get odds for a match
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

// Get match result
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

// Get today's matches
app.get('/api/matches/today', ensureAuth, async (req, res) => {
    try {
        const now = new Date();
        const todayStart = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
        const todayEnd = new Date(todayStart);
        todayEnd.setUTCDate(todayEnd.getUTCDate() + 1);
        
        const response = await axios.get(`${BASE_URL}/datafeed/prematch/api/v2/sportevents`, {
            params: { ref: REF, lng: 'en', sportIds: 1, count: 200 },
            headers: { Authorization: `Bearer ${req.authToken}` }
        });
        
        const allEvents = response.data.items || [];
        const todayEvents = allEvents.filter(event => 
            event.startDate >= Math.floor(todayStart.getTime() / 1000) && 
            event.startDate < Math.floor(todayEnd.getTime() / 1000)
        );
        
        res.json({ count: todayEvents.length, items: todayEvents });
    } catch (error) {
        res.status(error.response?.status || 500).json({ error: error.response?.data || error.message });
    }
});

// Get tomorrow's matches
app.get('/api/matches/tomorrow', ensureAuth, async (req, res) => {
    try {
        const now = new Date();
        const tomorrowStart = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate() + 1));
        const tomorrowEnd = new Date(tomorrowStart);
        tomorrowEnd.setUTCDate(tomorrowEnd.getUTCDate() + 1);
        
        const response = await axios.get(`${BASE_URL}/datafeed/prematch/api/v2/sportevents`, {
            params: { ref: REF, lng: 'en', sportIds: 1, count: 200 },
            headers: { Authorization: `Bearer ${req.authToken}` }
        });
        
        const allEvents = response.data.items || [];
        const tomorrowEvents = allEvents.filter(event => 
            event.startDate >= Math.floor(tomorrowStart.getTime() / 1000) && 
            event.startDate < Math.floor(tomorrowEnd.getTime() / 1000)
        );
        
        res.json({ count: tomorrowEvents.length, items: tomorrowEvents });
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

// Start server
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`⏰ Cron job scheduled: Daily at midnight UTC`);
    console.log(`📋 Categories: ${Object.keys(CATEGORIES).join(', ')}`);
    console.log(`📍 Manual trigger: /api/manual-generate`);
});

// Run once on startup (optional - comment out if not needed)
// setTimeout(() => midnightAutomation(), 10000);