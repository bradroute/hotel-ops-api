// src/app.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { asyncWrapper } = require('./utils/asyncWrapper');
const { errorHandler } = require('./middleware/errorHandler');

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

// Existing routers
app.use('/sms', smsRouter);
app.use('/analytics', analyticsRouter);

// 404 handler
app.use((req, res, next) => {
  res.status(404).json({ error: 'Not Found' });
});

// Error handler
app.use(errorHandler);

module.exports = app;
