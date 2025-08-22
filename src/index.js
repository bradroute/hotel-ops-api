// src/index.js
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { createClient } from '@supabase/supabase-js';

import { errorHandler } from './middleware/errorHandler.js';
import { supabaseUrl, supabaseKey, supabaseServiceRoleKey } from './config/index.js';

import requestsRouter from './routes/requests.js';
import analyticsRouter from './routes/analytics.js';
import webformRouter from './routes/webform.js';
import smsRouter from './routes/sms.js';
import roomsRouter from './routes/rooms.js';
import paymentsRouter from './routes/payments.js';   // Stripe setup & customer routes
import guestRouter from './routes/guest.js';         // GPS + property-code auth (+ depts)

// ✅ App account routes (email+password signup/login) and in-app request submit
import appAuthRouter from './routes/appAuth.js';
import appRequestsRouter from './routes/appRequests.js';

const app = express();
app.set('trust proxy', 1);

// Basic CORS (safe defaults; widen if you need specific origins)
app.use(cors());

// JSON body parser
app.use(express.json({ limit: '1mb' }));

// Supabase: expose anon + admin on app.locals for any routers that read from it
const supabase = createClient(supabaseUrl, supabaseKey);                 // public anon key
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey); // service role key
app.locals.supabase = supabase;
app.locals.supabaseAdmin = supabaseAdmin;

/* ───────────────────────────
 * Payments (Stripe)
 * ─────────────────────────── */
app.use('/api', paymentsRouter);

/* ───────────────────────────
 * Guest-facing routes
 * /guest/ping
 * /guest/start
 * /guest/properties/:hotelId/departments
 * ─────────────────────────── */
app.use('/guest', guestRouter);

/* ───────────────────────────
 * App account routes (global auth; no geo required)
 * ─────────────────────────── */
app.use(
  '/app',
  rateLimit({ windowMs: 60_000, max: 60, message: 'Too many requests, slow down.' }),
  appAuthRouter
);

/* ───────────────────────────
 * In-app request submission (X-App-Session required)
 *   Includes:
 *     - POST /app/request
 *     - GET  /app/requests
 *     - PATCH /app/requests/:id
 *     - POST /app/push/register  ← handled inside this router
 * ─────────────────────────── */
app.use(
  '/app',
  rateLimit({ windowMs: 60_000, max: 120, message: 'Too many requests, slow down.' }),
  appRequestsRouter
);

/* ───────────────────────────
 * Health check
 * ─────────────────────────── */
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

/* ───────────────────────────
 * Core routes
 * ─────────────────────────── */
app.use('/requests', requestsRouter);
app.use('/analytics', analyticsRouter);
app.use('/api/webform', webformRouter);

/* ───────────────────────────
 * Room check-in/check-out
 * ─────────────────────────── */
app.use('/rooms', roomsRouter);

/* ───────────────────────────
 * SMS webhook (rate limited)
 * ─────────────────────────── */
app.use(
  '/sms',
  (req, _res, next) => {
    console.log('🔍 /sms payload:', JSON.stringify(req.body, null, 2));
    next();
  },
  rateLimit({ windowMs: 60_000, max: 10, message: 'Too many SMS calls.' }),
  smsRouter
);

/* ───────────────────────────
 * 404 + Error handling
 * ─────────────────────────── */
app.use((req, res) => res.status(404).json({ error: 'Not Found' }));
app.use(errorHandler);

/* ───────────────────────────
 * Start server
 * ─────────────────────────── */
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`✅ Hotel Ops API running on http://localhost:${PORT}`);
});
