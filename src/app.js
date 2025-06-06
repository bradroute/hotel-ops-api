// src/app.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { asyncWrapper } = require('./utils/asyncWrapper');
const { errorHandler } = require('./middleware/errorHandler');
const rateLimit = require('express-rate-limit');

// Import all routers
const requestsRouter = require('./routes/requests');
const smsRouter = require('./routes/sms');
const analyticsRouter = require('./routes/analytics');

const app = express();

// ─── Health check ───────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});
// ─────────────────────────────────────────────────────────────────────

app.use(cors());
app.use(express.json());

// Mount the new requestsRouter
app.use('/requests', requestsRouter);

// Rate limiter for /sms: max 10 requests per minute per IP
const smsLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10,
  message: 'Too many SMS requests from this IP, please try again in a minute.',
});
app.use('/sms', smsLimiter, smsRouter);

// Existing analytics router
app.use('/analytics', analyticsRouter);

// 404 handler
app.use((req, res, next) => {
  res.status(404).json({ error: 'Not Found' });
});

// Error handler
app.use(errorHandler);

module.exports = app;
