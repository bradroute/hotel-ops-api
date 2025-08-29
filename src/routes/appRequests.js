// api/AppRequests.js
import { Router } from 'express';
import { supabaseAdmin, insertRequest } from '../services/supabaseService.js';
import { notifyStaffOnNewRequest } from '../services/notificationService.js';

const router = Router();
const DEFAULT_GEOFENCE_MILES = Number(process.env.GEOFENCE_MILES || 1);

/* ---------------- session helpers ---------------- */
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

/* ---------------- utils ---------------- */
function toE164(v = '') {
  const d = String(v).replace(/\D/g, '');
  if (!d) return '';
  return d.startsWith('1') ? `+${d}` : `+1${d}`;
}

// Normalize token so it passes your DB CHECK constraint:
// staff_devices.expo_push_token LIKE 'ExponentPushToken%'
function normalizeExpoToken(t) {
  if (typeof t !== 'string') return '';
  if (t.startsWith('ExpoPushToken[')) return t.replace('ExpoPushToken[', 'ExponentPushToken[');
  return t;
}

/* ---------------- geo ---------------- */
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

/* ===========================================================
 * POST /app/push/register
 * 1) Guest app (X-App-Session header present) -> app_push_tokens
 * 2) Staff app (no session) -> requires user_id + hotel_id -> staff_devices
 *    (No DB changes required; we do a select-then-insert/update to dedupe.)
 * =========================================================== */
router.post('/push/register', async (req, res) => {
  try {
    const sessionToken = req.header('X-App-Session');
    const sess = await getSession(sessionToken).catch(() => null);

    const rawToken = req.body?.expoPushToken || req.body?.expoToken;
    const platform = req.body?.platform || null;
    const deviceDesc = req.body?.deviceDesc || null;

    if (!rawToken || typeof rawToken !== 'string') {
      return res.status(400).json({ error: 'expoToken / expoPushToken is required' });
    }

    // Accept both ExpoPushToken[...] and ExponentPushToken[...], but
    // require the latter when writing to staff_devices (DB CHECK).
    const expoToken = normalizeExpoToken(rawToken);

    if (sess) {
      // ---- Guest app token registration (app_push_tokens) ----
      // Manual upsert (no UNIQUE needed): look up by (app_account_id, expo_token)
      const { data: existing, error: findErr } = await supabaseAdmin
        .from('app_push_tokens')
        .select('id')
        .eq('app_account_id', sess.app_account_id)
        .eq('expo_token', expoToken)
        .maybeSingle();
      if (findErr) throw findErr;

      if (existing?.id) {
        const { error: updErr } = await supabaseAdmin
          .from('app_push_tokens')
          .update({
            platform,
            device_desc: deviceDesc,
            updated_at: new Date().toISOString(),
          })
          .eq('id', existing.id);
        if (updErr) throw updErr;
      } else {
        const { error: insErr } = await supabaseAdmin
          .from('app_push_tokens')
          .insert({
            app_account_id: sess.app_account_id,
            expo_token: expoToken,
            platform,
            device_desc: deviceDesc,
          });
        if (insErr) throw insErr;
      }

      return res.json({ ok: true, mode: 'guest' });
    }

    // ---- Staff app token registration (staff_devices) ----
    const user_id = req.body?.user_id;
    const hotel_id = req.body?.hotel_id;
    if (!user_id || !hotel_id) {
      return res
        .status(401)
        .json({ error: 'Not signed in (guest) and missing user_id/hotel_id for staff registration' });
    }

    // Manual upsert by (user_id, expo_push_token)
    const { data: existing, error: sFindErr } = await supabaseAdmin
      .from('staff_devices')
      .select('id')
      .eq('user_id', user_id)
      .eq('expo_push_token', expoToken)
      .maybeSingle();
    if (sFindErr) throw sFindErr;

    if (existing?.id) {
      const { error: sUpdErr } = await supabaseAdmin
        .from('staff_devices')
        .update({
          hotel_id,
          platform,
          last_seen_at: new Date().toISOString(),
        })
        .eq('id', existing.id);
      if (sUpdErr) throw sUpdErr;
    } else {
      const { error: sInsErr } = await supabaseAdmin
        .from('staff_devices')
        .insert({
          user_id,
          hotel_id,
          expo_push_token: expoToken,
          platform,
          last_seen_at: new Date().toISOString(),
        });
      if (sInsErr) throw sInsErr;
    }

    return res.json({ ok: true, mode: 'staff' });
  } catch (e) {
    console.error('push/register error', e);
    return res.status(500).json({ error: e.message || 'Could not register push token' });
  }
});

/* ===========================================================
 * GET /app/spaces
 * Query: propertyCode | code (guest_code), or hotel_id
 * Optional search: q
 * Returns: { spaces: [{ id, name, slug }] }
 * (No reliance on a sort_order column.)
 * =========================================================== */
router.get('/spaces', async (req, res) => {
  try {
    const code = String(req.query.propertyCode || req.query.code || '').trim();
    const q = String(req.query.q || '').trim();
    let hotel_id = req.query.hotel_id ? String(req.query.hotel_id).trim() : '';

    if (!hotel_id) {
      if (!code) return res.status(400).json({ error: 'propertyCode (or hotel_id) is required.' });
      const { data: hotel, error: hErr } = await supabaseAdmin
        .from('hotels')
        .select('id, is_active')
        .eq('guest_code', code)
        .single();
      if (hErr || !hotel || hotel.is_active === false) {
        return res.status(404).json({ error: 'Hotel not found.' });
      }
      hotel_id = hotel.id;
    }

    let query = supabaseAdmin
      .from('hotel_spaces')
      .select('id, name, slug')
      .eq('hotel_id', hotel_id)
      .eq('is_active', true);

    if (q) query = query.ilike('name', `%${q}%`);

    const { data: spaces, error: sErr } = await query.order('name', { ascending: true });
    if (sErr) throw sErr;

    return res.json({ spaces: spaces ?? [] });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'Could not fetch spaces' });
  }
});

/* ===========================================================
 * POST /app/request
 * Requires X-App-Session; geofences; supports room OR space
 * Writes room label into requests.room_number and (if available)
 * the space_id into requests.space_id. Ensures from_phone is
 * NOT NULL by defaulting to '' if unknown (matches your schema).
 * =========================================================== */
router.post('/request', async (req, res) => {
  try {
    const token = req.header('X-App-Session');
    const sess = await getSession(token);
    if (!sess) return res.status(401).send('Not signed in.');

    const {
      propertyCode,
      message,
      lat,
      lng,
      roomNumber,
      spaceId,
      spaceSlug,
      spaceName,
      from_phone,
      priority,
      department,
    } = req.body || {};

    if (!propertyCode?.trim() || !message?.trim()) {
      return res.status(400).send('propertyCode and message are required.');
    }

    const roomProvided = !!(roomNumber && String(roomNumber).trim());
    const spaceProvided = !!(spaceId || spaceSlug || spaceName);
    if (!(roomProvided || spaceProvided)) {
      return res.status(400).send('Provide either roomNumber or a space (spaceId/spaceSlug/spaceName).');
    }
    if (roomProvided && spaceProvided) {
      return res.status(400).send('Provide only one: roomNumber OR space (not both).');
    }

    if (typeof lat !== 'number' || typeof lng !== 'number') {
      return res.status(400).send('Location required.');
    }

    const { data: hotel, error: hErr } = await supabaseAdmin
      .from('hotels')
      .select('id, latitude, longitude, is_active')
      .eq('guest_code', propertyCode.trim())
      .single();
    if (hErr || !hotel || hotel.is_active === false) {
      return res.status(404).send('Hotel not found.');
    }

    const dist = milesBetween(lat, lng, hotel.latitude, hotel.longitude);
    if (dist > DEFAULT_GEOFENCE_MILES) {
      return res.status(403).send('You must be on property to submit a request.');
    }

    // Resolve room/space
    let finalRoomLabel = '';
    let finalSpaceId = null;

    if (roomProvided) {
      finalRoomLabel = String(roomNumber).trim();
    } else {
      let spaceRow = null;

      if (spaceId) {
        const { data } = await supabaseAdmin
          .from('hotel_spaces')
          .select('id, name')
          .eq('hotel_id', hotel.id)
          .eq('id', spaceId)
          .eq('is_active', true)
          .maybeSingle();
        spaceRow = data;
      } else if (spaceSlug) {
        const { data } = await supabaseAdmin
          .from('hotel_spaces')
          .select('id, name')
          .eq('hotel_id', hotel.id)
          .eq('slug', String(spaceSlug).toLowerCase())
          .eq('is_active', true)
          .maybeSingle();
        spaceRow = data;
      } else if (spaceName) {
        const { data } = await supabaseAdmin
          .from('hotel_spaces')
          .select('id, name')
          .eq('hotel_id', hotel.id)
          .ilike('name', String(spaceName))
          .eq('is_active', true)
          .maybeSingle();
        spaceRow = data;
      }

      if (!spaceRow) {
        return res.status(404).send('Space not found at this property.');
      }
      finalRoomLabel = spaceRow.name;
      finalSpaceId = spaceRow.id;
    }

    // Determine phone: prefer body, else app_accounts.phone
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

    const created = await insertRequest({
      hotel_id: hotel.id,
      room_number: finalRoomLabel,
      space_id: finalSpaceId, // optional, FK exists in your schema
      message: String(message).trim().slice(0, 240),
      department: department ?? null,
      priority: priority ?? null,
      source: 'app_guest',
      from_phone: phone || '', // NOT NULL per schema
      app_account_id: sess.app_account_id,
      lat,
      lng,
    });

    // Fire-and-forget staff push
    notifyStaffOnNewRequest(created).catch((e) =>
      console.error('staff notify (app) failed', e)
    );

    return res.json({
      id: created.id,
      created_at: created.created_at,
      room_number: created.room_number,
      department: created.department,
      priority: created.priority,
    });
  } catch (e) {
    return res.status(500).send(e.message || 'Could not submit request');
  }
});

/* ===========================================================
 * GET /app/requests  (unchanged)
 * =========================================================== */
router.get('/requests', async (req, res) => {
  try {
    const token = req.header('X-App-Session');
    const sess = await getSession(token);
    if (!sess) return res.status(401).send('Not signed in.');

    const { data, error } = await supabaseAdmin
      .from('requests')
      .select(
        'id, created_at, message, department, priority, acknowledged, completed, cancelled, room_number'
      )
      .eq('app_account_id', sess.app_account_id)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return res.json({ requests: data || [] });
  } catch (e) {
    return res.status(500).send(e.message || 'Could not fetch requests');
  }
});

/* ===========================================================
 * PATCH /app/requests/:id  (unchanged)
 * =========================================================== */
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
      .select(
        'id, created_at, message, department, priority, acknowledged, completed, cancelled, room_number'
      )
      .single();
    if (uErr) throw uErr;

    return res.json(updated);
  } catch (e) {
    return res.status(500).send(e.message || 'Could not update request');
  }
});

export default router;
