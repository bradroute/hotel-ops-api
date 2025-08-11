// src/index.js
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { createClient } from '@supabase/supabase-js';

import { errorHandler } from './middleware/errorHandler.js';
import { supabaseUrl, supabaseServiceRoleKey } from './config/index.js';

import requestsRouter from './routes/requests.js';
import analyticsRouter from './routes/analytics.js';
import webformRouter from './routes/webform.js';
import smsRouter from './routes/sms.js';
import roomsRouter from './routes/rooms.js';
import paymentsRouter from './routes/payments.js';  // Stripe setup & customer routes
import guestRouter from './routes/guest.js';        // GPS + property-code auth

const app = express();
app.set('trust proxy', 1);
app.use(cors());
app.use(express.json());

// Make Supabase available to routers (guest.js expects this)
const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);
app.locals.supabase = supabase;

// Payments (Stripe)
app.use('/api', paymentsRouter);

// Guest authorization (no OTP)
// Routes in guest.js are `/ping` and `/start`, so mounting at `/guest` yields:
//   GET  /guest/ping
//   POST /guest/start
app.use('/guest', guestRouter);

// Health check
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// Core routes
app.use('/requests', requestsRouter);
app.use('/analytics', analyticsRouter);
app.use('/api/webform', webformRouter);

// Room check-in/check-out
app.use('/rooms', roomsRouter);

// SMS webhook with rate limiting
app.use(
  '/sms',
  (req, _res, next) => {
    console.log('🔍 /sms payload:', JSON.stringify(req.body, null, 2));
    next();
  },
  rateLimit({ windowMs: 60_000, max: 10, message: 'Too many SMS calls.' }),
  smsRouter
);

// 404 handler
app.use((req, res) => res.status(404).json({ error: 'Not Found' }));

// Global error handler
app.use(errorHandler);

// Start server
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`✅ Hotel Ops API running on http://localhost:${PORT}`);
});
