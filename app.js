require('dotenv').config();

const express = require('express');
const app = express();

// Middleware to parse JSON bodies
app.use(express.json());

// Route handlers
const smsRouter = require('./routes/sms');
app.use('/sms', smsRouter);

const analyticsRouter = require('./routes/analytics');
app.use('/analytics', analyticsRouter);

module.exports = app;
