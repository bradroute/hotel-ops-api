import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { errorHandler } from './middleware/errorHandler.js';

import requestsRouter from './routes/requests.js';
import smsRouter from './routes/sms.js';
import analyticsRouter from './routes/analytics.js';
import webformRouter from './routes/webform.js';

const app = express();
app.set('trust proxy', 1);
app.use(cors());
app.use(express.json());

// Health check route
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// Main API routes
app.use('/requests', requestsRouter);
app.use('/analytics', analyticsRouter);
app.use('/api/webform', webformRouter);

// SMS route with rate limiter & logger
app.use(
  '/sms',
  (req, res, next) => {
    console.log('🔍 /sms payload:', JSON.stringify(req.body, null, 2));
    next();
  },
  rateLimit({ windowMs: 60_000, max: 10, message: 'Too many SMS calls.' }),
  smsRouter
);

// 404 fallback
app.use((req, res) => res.status(404).json({ error: 'Not Found' }));

// Global error handler
app.use(errorHandler);

export default app;
