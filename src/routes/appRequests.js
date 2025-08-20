// api/AppRequests.js
import { Router } from 'express';
import { supabaseAdmin } from '../services/supabaseService.js';

const router = Router();

/* ---------- config ---------- */
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

/* ---------- geo helpers ---------- */
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

/* ---------- classification helpers ---------- */
const DEPT_KEYWORDS = {
  Valet: [
    /\b(valet|car|vehicle|garage|parking|retrieve|pick.*car|bring.*car|get.*car|my.*car)\b/i,
  ],
  Housekeeping: [
    /\b(towel|towels|pillow|pillows|blanket|blankets|sheet|sheets|linen|clean|cleanup|trash|housekeeping)\b/i,
  ],
  Maintenance: [
    /\b(fix|repair|broken|leak|clog|toilet|sink|plunge|ac|a\/c|air.?conditioning|heater|tv(?!\s?guide)|light(s)?\s(out)?)\b/i,
  ],
  'Room Service': [/\b(room ?service|food|order|menu|breakfast|dinner|lunch|coffee)\b/i],
  Concierge: [/\b(concierge|reservation|tickets?|recommend|tour|restaurant)\b/i],
  Bellhop: [/\b(bell\s?(hop|man)|porter|luggage|bags?)\b/i],
  Laundry: [/\b(laundry|dry\s?clean|wash|press)\b/i],
  Security: [/\b(security|noise\scomplaint|disturbance|lost|stolen)\b/i],
  IT: [/\b(wifi|wi-?fi|internet|login|password)\b/i],
  Shuttle: [/\b(shuttle|airport|ride|transport)\b/i],
  Spa: [/\b(spa|massage|appointment)\b/i],
  Pool: [/\b(pool|pool\s?towel)\b/i],
  Gym: [/\b(gym|fitness|treadmill|weights?)\b/i],
  'Front Desk': [
    /\b(front\sdesk|wake\s?call|late\s?check(out)?|key\s?card|check-?in|check-?out)\b/i,
  ],
};

function inferPriority(msg) {
  const t = (msg || '').toLowerCase();
  if (/\b(urgent|asap|immediately|right now|emergency)\b/.test(t)) return 'urgent';
  if (/\b(no rush|whenever|not urgent|low priority)\b/.test(t)) return 'low';
  return 'normal';
}

function inferDepartment(msg, enabledSet) {
  for (const [dept, patterns] of Object.entries(DEPT_KEYWORDS)) {
    if (!enabledSet.has(dept)) continue;
    if (patterns.some((re) => re.test(msg))) return dept;
  }
  return enabledSet.has('Front Desk') ? 'Front Desk' : [...enabledSet][0] || 'Front Desk';
}

async function getEnabledDepartments(hotelId, hotelFallbackArray = []) {
  const { data: rows, error } = await supabaseAdmin
    .from('department_settings')
    .select('department, enabled')
    .eq('hotel_id', hotelId);

  if (!error && rows && rows.length) {
    const set = new Set(rows.filter((r) => r.enabled).map((r) => r.department));
    if (set.size) return set;
  }
  const arr = Array.isArray(hotelFallbackArray) ? hotelFallbackArray : [];
  return new Set(arr.length ? arr : ['Front Desk', 'Housekeeping', 'Maintenance', 'Room Service', 'Valet']);
}

/* ---------- routes ---------- */

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
 * Body: { propertyCode, roomNumber, message, lat, lng, priority?, department?, from_phone? }
 * Requires: X-App-Session header
 */
router.post('/request', async (req, res) => {
  try {
    const token = req.header('X-App-Session');
    const sess = await getSession(token);
    if (!sess) return res.status(401).send('Not signed in.');

    const {
      propertyCode,
      roomNumber,
      message,
      lat,
      lng,
      priority: clientPriority,
      department: clientDepartment,
      from_phone, // <-- NEW: accept phone from client
    } = req.body || {};

    if (!propertyCode?.trim() || !roomNumber?.trim() || !message?.trim()) {
      return res.status(400).send('Property code, room number, and message are required.');
    }

    // Find hotel by code
    const { data: hotel, error: hErr } = await supabaseAdmin
      .from('hotels')
      .select('id, latitude, longitude, is_active, departments_enabled')
      .eq('guest_code', propertyCode.trim())
      .single();
    if (hErr || !hotel || hotel.is_active === false)
      return res.status(404).send('Hotel not found.');

    // Geofence (default 1 mile, configurable)
    if (typeof lat !== 'number' || typeof lng !== 'number') {
      return res.status(400).send('Location required.');
    }
    const dist = milesBetween(lat, lng, hotel.latitude, hotel.longitude);
    if (dist > DEFAULT_GEOFENCE_MILES) {
      return res.status(403).send('You must be on property to submit a request.');
    }

    // Enabled departments
    const enabledSet = await getEnabledDepartments(hotel.id, hotel.departments_enabled);

    // Classification
    const msg = String(message).trim();
    let department =
      clientDepartment && enabledSet.has(clientDepartment)
        ? clientDepartment
        : inferDepartment(msg, enabledSet);
    let priority = clientPriority || inferPriority(msg) || 'normal';

    // Determine phone: prefer body, else app account profile
    let phone = '';
    if (from_phone) {
      phone = toE164(from_phone);
    }
    if (!phone) {
      const { data: acct, error: aErr } = await supabaseAdmin
        .from('app_accounts')
        .select('phone')
        .eq('id', sess.app_account_id)
        .single();
      if (!aErr && acct?.phone) phone = toE164(acct.phone);
    }

    // Insert request (now with from_phone)
    const payload = {
      hotel_id: hotel.id,
      room_number: String(roomNumber).trim(),
      message: msg,
      department,
      priority,
      is_staff: false,
      source: 'app_guest',
      from_phone: phone || null, // <-- persists to requests table
      app_account_id: sess.app_account_id,
    };

    const { data: reqRow, error: rErr } = await supabaseAdmin
      .from('requests')
      .insert(payload)
      .select('id, created_at, department, priority')
      .single();
    if (rErr) throw rErr;

    return res.json({
      id: reqRow.id,
      created_at: reqRow.created_at,
      department: reqRow.department,
      priority: reqRow.priority,
    });
  } catch (e) {
    return res.status(500).send(e.message || 'Could not submit request');
  }
});

/**
 * GET /app/requests
 */
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

/**
 * PATCH /app/requests/:id
 * (unchanged)
 */
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
