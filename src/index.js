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

/* ───────────────────────────
 * CORS (allowlist your frontend)
 * ─────────────────────────── */
const FRONTEND_ORIGIN =
  process.env.FRONTEND_ORIGIN ||
  process.env.REACT_APP_API_URL || // if this is your frontend origin, keep it
  '';

const corsOptions = {
  origin: (origin, cb) => {
    // allow same-origin / server-to-server / tools (no Origin header)
    if (!origin) return cb(null, true);

    const allowlist = new Set([
      FRONTEND_ORIGIN,
      'http://localhost:5173',
      'http://localhost:3000',
      'http://127.0.0.1:5173',
      'http://127.0.0.1:3000',
    ].filter(Boolean));

    return allowlist.has(origin) ? cb(null, true) : cb(new Error('CORS: origin not allowed'));
  },
  credentials: true,
};
app.use(cors(corsOptions));

/* ───────────────────────────
 * Stripe webhook RAW body (must be BEFORE express.json)
 * If your paymentsRouter exposes e.g. POST /api/stripe/webhook and uses req.rawBody,
 * mount a raw parser specifically for that path here. Adjust the path if different.
 * ─────────────────────────── */
const STRIPE_WEBHOOK_PATH = process.env.STRIPE_WEBHOOK_PATH || '/api/stripe/webhook';
app.post(STRIPE_WEBHOOK_PATH, express.raw({ type: 'application/json' }), (req, res, next) => {
  // Let paymentsRouter handle it; this ensures body stays raw for signature verification.
  next();
});

/* ───────────────────────────
 * JSON body parser (safe size)
 * ─────────────────────────── */
app.use(express.json({ limit: '1mb' }));

/* ───────────────────────────
 * Supabase clients on app.locals
 * ─────────────────────────── */
const supabase = createClient(supabaseUrl, supabaseKey);                 // public anon key
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey); // service role key
app.locals.supabase = supabase;
app.locals.supabaseAdmin = supabaseAdmin;

/* ───────────────────────────
 * Payments (Stripe)
 * NOTE: paymentsRouter should internally use `express.raw` ONLY on the webhook route.
 * All other routes will see JSON due to the global parser above.
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
    // keep it light to avoid logging PII; trim long payloads
    try {
      const preview = JSON.stringify(req.body).slice(0, 500);
      console.log('🔍 /sms payload:', preview);
    } catch {}
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
