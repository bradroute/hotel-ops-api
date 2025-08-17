// src/routes/appPush.js
import { Router } from 'express';
import { supabaseAdmin } from '../services/supabaseService.js';

const router = Router();

async function getSession(token) {
  if (!token) return null;
  const { data, error } = await supabaseAdmin
    .from('app_auth_sessions')
    .select('app_account_id, expires_at')
    .eq('token', token)
    .maybeSingle();
  if (error || !data) return null;
  if (new Date(data.expires_at) < new Date()) return null;
  return data;
}

// POST /app/push/register
router.post('/register', async (req, res) => {
  try {
    const token = req.header('X-App-Session');
    const sess = await getSession(token);
    if (!sess) return res.status(401).send('Not signed in.');

    const { expoToken, platform, deviceLabel } = req.body || {};
    if (!expoToken) return res.status(400).send('expoToken required.');

    const { data, error } = await supabaseAdmin
      .from('app_push_tokens')
      .upsert(
        {
          app_account_id: sess.app_account_id,
          expo_token: String(expoToken),
          platform: platform || null,
          device_label: deviceLabel || null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'app_account_id,expo_token' }
      )
      .select()
      .limit(1)
      .single();

    if (error) throw error;
    return res.json({ success: true, token: data?.expo_token });
  } catch (e) {
    return res.status(500).send(e.message || 'server_error');
  }
});

// POST /app/push/unregister (optional)
router.post('/unregister', async (req, res) => {
  try {
    const token = req.header('X-App-Session');
    const sess = await getSession(token);
    if (!sess) return res.status(401).send('Not signed in.');

    const { expoToken } = req.body || {};
    if (!expoToken) return res.status(400).send('expoToken required.');

    const { error } = await supabaseAdmin
      .from('app_push_tokens')
      .delete()
      .eq('app_account_id', sess.app_account_id)
      .eq('expo_token', String(expoToken));

    if (error) throw error;
    return res.json({ success: true });
  } catch (e) {
    return res.status(500).send(e.message || 'server_error');
  }
});

export default router;
