// src/routes/appPush.js
import express from 'express';
import { supabaseAdmin } from '../services/supabaseService.js';

const router = express.Router();

/**
 * POST /app/push/register
 * STAFF:  body { user_id, hotel_id, expoPushToken, platform, device_desc? }
 * GUEST:  headers { 'X-App-Session': token } body { expoPushToken, platform, device_desc? }
 */
router.post('/register', async (req, res) => {
  try {
    const sessionToken = req.header('X-App-Session');
    const {
      user_id,            // staff only
      hotel_id,           // staff only
      expoPushToken,      // preferred client key
      expo_token,         // alt key (we also accept this)
      platform,
      device_desc = null,
    } = req.body || {};

    const token = expoPushToken || expo_token;
    if (!token || !platform) {
      return res.status(400).json({ ok: false, error: 'Missing token or platform' });
    }

    // ----- Guest path (App) -----
    if (sessionToken) {
      // validate session → get app_account_id
      const { data: session, error: sErr } = await supabaseAdmin
        .from('app_sessions')
        .select('app_account_id, expires_at')
        .eq('token', sessionToken)
        .single();

      if (sErr || !session) {
        return res.status(401).json({ ok: false, error: 'Invalid app session' });
      }

      // upsert into app_push_tokens by expo_token
      const { data: existing } = await supabaseAdmin
        .from('app_push_tokens')
        .select('id')
        .eq('expo_token', token)
        .maybeSingle();

      if (existing?.id) {
        await supabaseAdmin
          .from('app_push_tokens')
          .update({
            app_account_id: session.app_account_id,
            platform,
            device_desc,
            updated_at: new Date().toISOString(),
          })
          .eq('id', existing.id);
      } else {
        await supabaseAdmin.from('app_push_tokens').insert([{
          app_account_id: session.app_account_id,
          expo_token: token,
          platform,
          device_desc,
        }]);
      }

      return res.json({ ok: true, scope: 'guest', app_account_id: session.app_account_id });
    }

    // ----- Staff path -----
    if (!user_id || !hotel_id) {
      return res.status(400).json({ ok: false, error: 'Missing user_id or hotel_id' });
    }

    // upsert into staff_devices by expo_push_token
    const { data: existing } = await supabaseAdmin
      .from('staff_devices')
      .select('id')
      .eq('expo_push_token', token)
      .maybeSingle();

    if (existing?.id) {
      await supabaseAdmin
        .from('staff_devices')
        .update({
          user_id,
          hotel_id,
          platform,
          last_seen_at: new Date().toISOString(),
        })
        .eq('id', existing.id);
    } else {
      await supabaseAdmin.from('staff_devices').insert([{
        user_id,
        hotel_id,
        expo_push_token: token,
        platform,
      }]);
    }

    return res.json({ ok: true, scope: 'staff', user_id, hotel_id });
  } catch (e) {
    console.error('[appPush.register] error:', e);
    return res.status(500).json({ ok: false, error: 'Server error' });
  }
});

export default router;
