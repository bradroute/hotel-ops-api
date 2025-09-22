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
import paymentsRouter from './routes/payments.js';
import guestRouter from './routes/guest.js';

import appAuthRouter from './routes/appAuth.js';
import appRequestsRouter from './routes/appRequests.js';

const app = express();
app.set('trust proxy', 1);

/* ───────────────────────────
 * CORS (env-driven allowlist; subdomain friendly)
 * ─────────────────────────── */
const allowHosts = (process.env.CORS_ALLOW_HOSTS || 'localhost')
  .split(',')
  .map(s => s.trim().toLowerCase())
  .filter(Boolean);

const corsOpts = {
  origin(origin, cb) {
    // allow same-origin / server-to-server (no Origin header)
    if (!origin) return cb(null, true);
    try {
      const host = new URL(origin).hostname.toLowerCase();
      const ok = allowHosts.some(h =>
        host === h || host.endsWith(`.${h}`) || (h === 'localhost' && host.startsWith('localhost'))
      );
      if (ok) return cb(null, true);
    } catch {
      // bad Origin header → block
    }
    console.warn('[CORS] blocked origin:', origin);
    cb(new Error('CORS: origin not allowed'));
  },
  credentials: true,
  methods: ['GET','HEAD','PUT','PATCH','POST','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-App-Session', 'X-App-Auth'],
};
app.use(cors(corsOpts));
app.options('*', cors(corsOpts));

/* ───────────────────────────
 * Stripe webhook RAW body (before express.json)
 * ─────────────────────────── */
const STRIPE_WEBHOOK_PATH = process.env.STRIPE_WEBHOOK_PATH || '/api/stripe/webhook';
app.post(STRIPE_WEBHOOK_PATH, express.raw({ type: 'application/json' }), (req, res, next) => next());

/* ───────────────────────────
 * JSON body parser
 * ─────────────────────────── */
app.use(express.json({ limit: '1mb' }));

/* ───────────────────────────
 * Supabase clients on app.locals
 * ─────────────────────────── */
const supabase = createClient(supabaseUrl, supabaseKey);
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey);
app.locals.supabase = supabase;
app.locals.supabaseAdmin = supabaseAdmin;

/* ───────────────────────────
 * Payments (Stripe)
 * ─────────────────────────── */
app.use('/api', paymentsRouter);

/* ───────────────────────────
 * Guest-facing routes
 * ─────────────────────────── */
app.use(['/guest', '/api/guest'], guestRouter);

/* ───────────────────────────
 * App account & in-app requests
 * ─────────────────────────── */
app.use(
  '/app',
  rateLimit({ windowMs: 60_000, max: 60, message: 'Too many requests, slow down.' }),
  appAuthRouter
);
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
 * Core routes (+ /api aliases)
 * ─────────────────────────── */
app.use(['/requests', '/api/requests'], requestsRouter);
app.use(['/analytics', '/api/analytics'], analyticsRouter);
app.use(['/api/webform', '/webform'], webformRouter);
app.use(['/rooms', '/api/rooms'], roomsRouter);

/* ───────────────────────────
 * SMS webhook (rate limited)
 * ─────────────────────────── */
app.use(
  ['/sms', '/api/sms'],
  (req, _res, next) => {
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
