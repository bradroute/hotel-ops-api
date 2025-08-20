// api/AppRequests.js
import { Router } from 'express';
import { supabaseAdmin, insertRequest } from '../services/supabaseService.js';

const router = Router();
const DEFAULT_GEOFENCE_MILES = Number(process.env.GEOFENCE_MILES || 1);

/* ---------- session helpers ---------- */
async function getSession(token) {
  if (!token) return null;
  const { data, error } = await supabaseAdmin
    .from('app_auth_sessions')
    .select('app_account_id, expires_at')
    .eq('token', token)
    .single();
  if (error || !data) return null;
  if (new Date(data.expires_at) < new Date()) return null;
  return data;
}

/* ---------- utils ---------- */
function toE164(v = '') {
  const d = String(v).replace(/\D/g, '');
  if (!d) return '';
  return d.startsWith('1') ? `+${d}` : `+1${d}`;
}

/* ---------- geo ---------- */
function milesBetween(lat1, lon1, lat2, lon2) {
  const R = 3958.7613;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/* ---------- routes ---------- */

// Push register unchanged
router.post('/push/register', async (req, res) => {
  try {
    const token = req.header('X-App-Session');
    const sess = await getSession(token);
    if (!sess) return res.status(401).send('Not signed in.');

    const { expoToken, platform, deviceDesc } = req.body || {};
    if (!expoToken || typeof expoToken !== 'string') {
      return res.status(400).send('expoToken required');
    }

    const { error } = await supabaseAdmin
      .from('app_push_tokens')
      .upsert(
        {
          app_account_id: sess.app_account_id,
          expo_token: expoToken,
          platform: platform || null,
          device_desc: deviceDesc || null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'app_account_id,expo_token' }
      );

    if (error) throw error;
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).send(e.message || 'Could not register push token');
  }
});

/**
 * POST /app/request
 * Body: { propertyCode, roomNumber, message, lat, lng, from_phone? }
 * Requires: X-App-Session header
 * Note: Department & priority come from AI in insertRequest().
 */
router.post('/request', async (req, res) => {
  try {
    const token = req.header('X-App-Session');
    const sess = await getSession(token);
    if (!sess) return res.status(401).send('Not signed in.');

    const { propertyCode, roomNumber, message, lat, lng, from_phone } = req.body || {};
    if (!propertyCode?.trim() || !roomNumber?.trim() || !message?.trim()) {
      return res.status(400).send('Property code, room number, and message are required.');
    }

    // Find hotel by code
    const { data: hotel, error: hErr } = await supabaseAdmin
      .from('hotels')
      .select('id, latitude, longitude, is_active')
      .eq('guest_code', propertyCode.trim())
      .single();
    if (hErr || !hotel || hotel.is_active === false) {
      return res.status(404).send('Hotel not found.');
    }

    // Geofence
    if (typeof lat !== 'number' || typeof lng !== 'number') {
      return res.status(400).send('Location required.');
    }
    const dist = milesBetween(lat, lng, hotel.latitude, hotel.longitude);
    if (dist > DEFAULT_GEOFENCE_MILES) {
      return res.status(403).send('You must be on property to submit a request.');
    }

    // Determine phone: prefer body, else profile
    let phone = '';
    if (from_phone) phone = toE164(from_phone);
    if (!phone) {
      const { data: acct } = await supabaseAdmin
        .from('app_accounts')
        .select('phone')
        .eq('id', sess.app_account_id)
        .single();
      if (acct?.phone) phone = toE164(acct.phone);
    }

    // Let the service (AI) set department & priority
    const created = await insertRequest({
      hotel_id: hotel.id,
      room_number: String(roomNumber).trim(),
      message: String(message).trim().slice(0, 240),
      department: null,            // AI fills
      priority: null,              // AI fills
      source: 'app_guest',
      from_phone: phone || null,
      app_account_id: sess.app_account_id,
      lat,
      lng,
    });

    return res.json({
      id: created.id,
      created_at: created.created_at,
      department: created.department,
      priority: created.priority,
    });
  } catch (e) {
    return res.status(500).send(e.message || 'Could not submit request');
  }
});

/** GET /app/requests (unchanged) */
router.get('/requests', async (req, res) => {
  try {
    const token = req.header('X-App-Session');
    const sess = await getSession(token);
    if (!sess) return res.status(401).send('Not signed in.');

    const { data, error } = await supabaseAdmin
      .from('requests')
      .select('id, created_at, message, department, priority, acknowledged, completed, cancelled')
      .eq('app_account_id', sess.app_account_id)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return res.json({ requests: data || [] });
  } catch (e) {
    return res.status(500).send(e.message || 'Could not fetch requests');
  }
});

/** PATCH /app/requests/:id (unchanged) */
router.patch('/requests/:id', async (req, res) => {
  try {
    const token = req.header('X-App-Session');
    const sess = await getSession(token);
    if (!sess) return res.status(401).send('Not signed in.');

    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).send('Invalid id.');

    const { data: row, error: fErr } = await supabaseAdmin
      .from('requests')
      .select('id, app_account_id, acknowledged, completed, cancelled, message, priority')
      .eq('id', id)
      .single();

    if (fErr || !row) return res.status(404).send('Request not found.');
    if (row.app_account_id !== sess.app_account_id) return res.status(403).send('Forbidden.');
    if (row.completed || row.cancelled) return res.status(400).send('Request can no longer be modified.');

    const { message, priority, cancel } = req.body || {};
    const patch = {};

    if (cancel === true) {
      patch.cancelled = true;
    } else {
      if (typeof message === 'string') {
        if (row.acknowledged) return res.status(400).send('Message cannot be edited after acknowledgement.');
        if (!message.trim()) return res.status(400).send('Message cannot be empty.');
        patch.message = message.trim();
      }
      if (typeof priority === 'string') patch.priority = priority.trim();
    }

    if (Object.keys(patch).length === 0) return res.status(400).send('No changes provided.');

    const { data: updated, error: uErr } = await supabaseAdmin
      .from('requests')
      .update(patch)
      .eq('id', id)
      .select('id, created_at, message, department, priority, acknowledged, completed, cancelled')
      .single();
    if (uErr) throw uErr;

    return res.json(updated);
  } catch (e) {
    return res.status(500).send(e.message || 'Could not update request');
  }
});

export default router;
