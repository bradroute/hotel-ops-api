// src/app.js

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

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.use('/requests', requestsRouter);

app.use(
  '/sms',
  rateLimit({ windowMs: 60_000, max: 10, message: 'Too many SMS calls.' }),
  smsRouter
);

app.use('/analytics', analyticsRouter);
app.use('/api/webform', webformRouter);

// 404 + error handler
app.use((req, res) => res.status(404).json({ error: 'Not Found' }));
app.use(errorHandler);

export default app;
