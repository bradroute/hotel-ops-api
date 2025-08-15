// src/routes/appAuth.js
import { Router } from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { supabaseAdmin } from '../services/supabaseService.js'; // your existing admin client

const router = Router();
const SESSION_HOURS = 720; // 30 days

function makeToken() {
  return crypto.randomBytes(32).toString('hex');
}
function addHours(d, h) {
  return new Date(d.getTime() + h*3600*1000);
}

router.post('/signup', async (req, res) => {
  try {
    const { fullName, email, phone, password } = req.body || {};
    if (!fullName?.trim() || !email?.trim() || !phone?.trim() || !password) {
      return res.status(400).send('All fields are required.');
    }
    const password_hash = await bcrypt.hash(password, 12);

    // Upsert by email
    const { data: upserted, error: upErr } = await supabaseAdmin
      .from('app_accounts')
      .upsert({ email: email.trim().toLowerCase(), full_name: fullName.trim(), phone, password_hash })
      .select('id')
      .single();
    if (upErr) throw upErr;

    const token = makeToken();
    const expires_at = addHours(new Date(), SESSION_HOURS).toISOString();

    const { error: sessErr } = await supabaseAdmin
      .from('app_auth_sessions')
      .insert({ token, app_account_id: upserted.id, expires_at });
    if (sessErr) throw sessErr;

    return res.json({ app_account_id: upserted.id, session_token: token, expires_at });
  } catch (e) {
    return res.status(500).send(e.message || 'Signup failed');
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email?.trim() || !password) return res.status(400).send('Email and password are required.');
    const { data: acct, error: fErr } = await supabaseAdmin
      .from('app_accounts')
      .select('id, password_hash')
      .eq('email', email.trim().toLowerCase())
      .single();
    if (fErr || !acct) return res.status(401).send('Invalid credentials.');
    const ok = await bcrypt.compare(password, acct.password_hash || '');
    if (!ok) return res.status(401).send('Invalid credentials.');

    const token = makeToken();
    const expires_at = addHours(new Date(), SESSION_HOURS).toISOString();
    const { error: sessErr } = await supabaseAdmin
      .from('app_auth_sessions')
      .insert({ token, app_account_id: acct.id, expires_at });
    if (sessErr) throw sessErr;

    return res.json({ app_account_id: acct.id, session_token: token, expires_at });
  } catch (e) {
    return res.status(500).send(e.message || 'Login failed');
  }
});
export default router;
