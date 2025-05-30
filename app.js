require('dotenv').config();

const express = require('express');
const cors = require('cors'); // ✅ added
const app = express();

app.use(cors());              // ✅ added
app.use(express.json());

const smsRouter = require('./routes/sms');
app.use('/sms', smsRouter);

const analyticsRouter = require('./routes/analytics');
app.use('/analytics', analyticsRouter);

module.exports = app;
