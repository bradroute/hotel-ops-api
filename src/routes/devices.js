// src/routes/devices.js
import express from 'express';
import { supabaseAdmin } from '../services/supabaseService.js';
import { requireAuth } from '../middleware/auth.js'; // assumes you have something similar

const router = express.Router();

/** STAFF registers token */
router.post('/register-staff', requireAuth, async (req, res) => {
  const user_id = req.user?.id;
  const { expoPushToken, platform, hotel_id } = req.body || {};
  if (!user_id || !expoPushToken || !hotel_id) {
    return res.status(400).json({ error: 'Missing user_id, token, or hotel_id' });
  }
  const { error } = await supabaseAdmin
    .from('staff_devices')
    .upsert({ user_id, hotel_id, expo_push_token: expoPushToken, platform, last_seen_at: new Date().toISOString() }, { onConflict: 'user_id,expo_push_token' });

  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

/** GUEST registers token (if you support guest app) */
router.post('/register-guest', async (req, res) => {
  const { guest_user_id, phone, expoPushToken, platform } = req.body || {};
  if (!expoPushToken || (!guest_user_id && !phone)) {
    return res.status(400).json({ error: 'Missing token and guest identifier' });
  }
  const { error } = await supabaseAdmin
    .from('guest_devices')
    .insert({ guest_user_id, phone, expo_push_token: expoPushToken, platform, last_seen_at: new Date().toISOString() });

  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

export default router;
