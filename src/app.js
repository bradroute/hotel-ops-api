// src/app.js
require('dotenv').config();
const express     = require('express');
const cors        = require('cors');
const rateLimit   = require('express-rate-limit');
const { asyncWrapper }   = require('./utils/asyncWrapper');
const { errorHandler }   = require('./middleware/errorHandler');

// Import all routers
const requestsRouter   = require('./routes/requests');
const smsRouter        = require('./routes/sms');
const analyticsRouter  = require('./routes/analytics');

const app = express();

// ─── Trust Proxy ───────────────────────────────────────────────────────
// This lets express-rate-limit correctly read X-Forwarded-For on Render
app.set('trust proxy', 1);

// ─── Health check ───────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});
// ─────────────────────────────────────────────────────────────────────

// CORS & body parsing
app.use(cors());
app.use(express.json());

// Mount the requests router
app.use('/requests', requestsRouter);

// ─── SMS Webhook with rate limiter & raw-body logging ────────────────
// First, log the incoming payload so we can see exactly what Telnyx is sending
app.use('/sms', (req, res, next) => {
  console.log('🔍 Incoming /sms payload:', JSON.stringify(req.body, null, 2));
  next();
});

// Then apply rate limiting
const smsLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10,
  message: 'Too many SMS requests from this IP, please try again in a minute.',
});
app.use('/sms', smsLimiter, smsRouter);

// Mount the analytics router
app.use('/analytics', analyticsRouter);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not Found' });
});

// Error handler
app.use(errorHandler);

module.exports = app;
