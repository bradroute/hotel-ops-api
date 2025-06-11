// src/app.js
require('dotenv').config();
const express     = require('express');
const cors        = require('cors');
const rateLimit   = require('express-rate-limit');
const { errorHandler } = require('./middleware/errorHandler');

// Routers
const requestsRouterRaw  = require('./routes/requests');
const smsRouterRaw       = require('./routes/sms');
const analyticsRouterRaw = require('./routes/analytics');
const webformRouterRaw   = require('./routes/webform');

// Helper to unwrap default exports if present
function unwrap(m) {
  return (m && m.default) ? m.default : m;
}

// Unwrapped routers
const requestsRouter  = unwrap(requestsRouterRaw);
const smsRouter       = unwrap(smsRouterRaw);
const analyticsRouter = unwrap(analyticsRouterRaw);
const webformRouter   = unwrap(webformRouterRaw);

const app = express();

// Trust proxy (for Render, etc)
app.set('trust proxy', 1);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Global middleware
app.use(cors());
app.use(express.json());

// 1️⃣ Requests API
app.use('/requests', requestsRouter);

// 2️⃣ SMS webhook
app.use(
  '/sms',
  (req, res, next) => {
    console.log('🔍 Incoming /sms payload:', JSON.stringify(req.body, null, 2));
    next();
  },
  rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    message: 'Too many SMS requests; try again later.',
  }),
  smsRouter
);

// 3️⃣ Analytics API
app.use('/analytics', analyticsRouter);

// 4️⃣ Webform endpoint
app.use('/api/webform', webformRouter);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not Found' });
});

// Error handler
app.use(errorHandler);

module.exports = app;
