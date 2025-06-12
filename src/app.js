// src/app.js

import dotenv from 'dotenv';
dotenv.config();

// 👉 Add WebSocket polyfill for Supabase compatibility
import ws from 'ws';
if (typeof WebSocket === 'undefined') {
  global.WebSocket = ws;
}

import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { errorHandler } from './middleware/errorHandler.js';

// Import your routers
import requestsRouter from './routes/requests.js';
import smsRouter from './routes/sms.js';
import analyticsRouter from './routes/analytics.js';
import webformRouter from './routes/webform.js';

const app = express();
app.set('trust proxy', 1);  // behind Render or other proxies
app.use(cors());
app.use(express.json());

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// 1️⃣ Requests API
app.use('/requests', requestsRouter);

// 2️⃣ SMS webhook (logging → rate-limit → router)
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

export default app;
