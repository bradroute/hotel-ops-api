// src/app.js
require('dotenv').config();

// 👉 Add WebSocket polyfill for Supabase compatibility
if (typeof WebSocket === 'undefined') {
  global.WebSocket = require('ws');
}

const express     = require('express');
const cors        = require('cors');
const rateLimit   = require('express-rate-limit');
const { errorHandler } = require('./middleware/errorHandler');

// Import your routers
const requestsRouterRaw  = require('./routes/requests');
const smsRouterRaw       = require('./routes/sms');
const analyticsRouterRaw = require('./routes/analytics');
const webformRouterRaw   = require('./routes/webform');

// Unwrap potential ESM default exports
function unwrap(m) {
  return (m && m.default) ? m.default : m;
}
const requestsRouter  = unwrap(requestsRouterRaw);
const smsRouter       = unwrap(smsRouterRaw);
const analyticsRouter = unwrap(analyticsRouterRaw);
const webformRouter   = unwrap(webformRouterRaw);

const app = express();
app.set('trust proxy', 1);             // behind Render or other proxies
app.use(cors());
app.use(express.json());

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// 1️⃣ Requests API
app.use('/requests', requestsRouter);

// 2️⃣ SMS webhook (logging → rate‐limit → router)
app.use(
  '/sms',
  (req, res, next) => {
    console.log('🔍 /sms payload:', JSON.stringify(req.body, null, 2));
    next();
  },
  rateLimit({ windowMs: 60_000, max: 10, message: 'Too many SMS calls.' }),
  smsRouter
);

// 3️⃣ Analytics API
app.use('/analytics', analyticsRouter);

// 4️⃣ Webform endpoint
app.use('/api/webform', webformRouter);

// 404 handler
app.use((req, res) => res.status(404).json({ error: 'Not Found' }));

// Central error handler
app.use(errorHandler);

module.exports = app;
