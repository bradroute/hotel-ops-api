// src/app.js

require('dotenv').config(); // ensures config is loaded, but we already do this in config/index.js too

const express = require('express');
const cors = require('cors');
const { asyncWrapper } = require('./utils/asyncWrapper'); // (you already have this)
const { errorHandler } = require('./middleware/errorHandler'); // create this next

const smsRouter = require('./routes/sms');
const analyticsRouter = require('./routes/analytics');

const app = express();

// ─── Health check ───────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});
// ─────────────────────────────────────────────────────────────────────────

app.use(cors());
app.use(express.json());

// Mount routers
app.use('/sms', smsRouter);
app.use('/analytics', analyticsRouter);

// 404 handler, if you want (optional)
app.use((req, res, next) => {
  res.status(404).json({ error: 'Not Found' });
});

// Centralized error handler (see next step)
app.use(errorHandler);

module.exports = app;
