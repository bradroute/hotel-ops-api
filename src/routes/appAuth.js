// src/routes/appAuth.js
import { Router } from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { supabaseAdmin } from '../services/supabaseService.js';

const router = Router();

const SESSION_HOURS = Number(process.env.APP_SESSION_HOURS || 24 * 30); // default 30 days
const PASSWORD_COST = Number(process.env.PASSWORD_COST || 12);

/* ───────────── helpers ───────────── */
function makeToken() {
  return crypto.randomBytes(32).toString('hex');
}
function addHours(date, hours) {
  return new Date(date.getTime() + hours * 3600 * 1000);
}
function normEmail(v = '') {
  return String(v).trim().toLowerCase();
}
function toE164(v = '') {
  const d = String(v).replace(/\D/g, '');
  if (!d) return '';
  return d.startsWith('1') ? `+${d}` : `+1${d}`;
}
function isReasonablePassword(p = '') {
  // simple baseline: 8–128 chars
  return typeof p === 'string' && p.length >= 8 && p.length <= 128;
}
function isEmailLike(e = '') {
  // very light validation; rely on unique constraint in DB
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

/* ───────────── POST /app/signup ───────────── */
router.post('/signup', async (req, res) => {
  try {
    const fullName = String(req.body?.fullName || '').trim();
    const email = normEmail(req.body?.email || '');
    const phone = toE164(req.body?.phone || '');
    const password = req.body?.password || '';

    if (!fullName || !email || !phone || !password) {
      return res.status(400).json({ error: 'All fields are required.' });
    }
    if (!isEmailLike(email)) {
      return res.status(400).json({ error: 'Invalid email address.' });
    }
    if (!phone) {
      return res.status(400).json({ error: 'Invalid phone number.' });
    }
    if (!isReasonablePassword(password)) {
      return res.status(400).json({ error: 'Password must be 8–128 characters.' });
    }

    // Ensure email is not already registered (avoid upsert password overwrite risk)
    const { data: existing, error: findErr } = await supabaseAdmin
      .from('app_accounts')
      .select('id')
      .eq('email', email)
      .maybeSingle();
    if (findErr) throw findErr;
    if (existing?.id) {
      return res.status(409).json({ error: 'Email is already registered.' });
    }

    const password_hash = await bcrypt.hash(password, PASSWORD_COST);

    const { data: created, error: insErr } = await supabaseAdmin
      .from('app_accounts')
      .insert({
        email,
        full_name: fullName,
        phone,
        password_hash,
        created_at: new Date().toISOString(),
      })
      .select('id')
      .single();
    if (insErr) throw insErr;

    const token = makeToken();
    const expires_at = addHours(new Date(), SESSION_HOURS).toISOString();

    const { error: sessErr } = await supabaseAdmin
      .from('app_auth_sessions')
      .insert({ token, app_account_id: created.id, expires_at });
    if (sessErr) throw sessErr;

    return res.json({
      app_account_id: created.id,
      session_token: token,
      expires_at,
    });
  } catch (e) {
    console.error('[signup] error:', e);
    return res.status(500).json({ error: e.message || 'Signup failed' });
  }
});

/* ───────────── POST /app/login ───────────── */
router.post('/login', async (req, res) => {
  try {
    const email = normEmail(req.body?.email || '');
    const password = req.body?.password || '';

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }
    if (!isEmailLike(email)) {
      return res.status(400).json({ error: 'Invalid email address.' });
    }

    const { data: acct, error: fErr } = await supabaseAdmin
      .from('app_accounts')
      .select('id, password_hash')
      .eq('email', email)
      .maybeSingle();

    if (fErr) throw fErr;
    if (!acct?.id || !acct.password_hash) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    const ok = await bcrypt.compare(password, acct.password_hash);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials.' });

    const token = makeToken();
    const expires_at = addHours(new Date(), SESSION_HOURS).toISOString();

    const { error: sessErr } = await supabaseAdmin
      .from('app_auth_sessions')
      .insert({ token, app_account_id: acct.id, expires_at });
    if (sessErr) throw sessErr;

    return res.json({
      app_account_id: acct.id,
      session_token: token,
      expires_at,
    });
  } catch (e) {
    console.error('[login] error:', e);
    return res.status(500).json({ error: e.message || 'Login failed' });
  }
});

export default router;
