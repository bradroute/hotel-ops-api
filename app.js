require('dotenv').config();

const express = require('express');
const app = express();

// Middleware to parse JSON bodies
app.use(express.json());

// Route handler
const smsRouter = require('./routes/sms');
app.use('/sms', smsRouter);

module.exports = app;
