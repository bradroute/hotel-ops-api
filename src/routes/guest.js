// src/routes/guest.js
import express from 'express';
import { randomUUID } from 'crypto';

const router = express.Router();

const DEFAULT_GEOFENCE_METERS = Number(process.env.GEOFENCE_METERS || 1609); // ~1 mile
const DEFAULT_DEPTS = ['Front Desk', 'Housekeeping', 'Maintenance', 'Room Service', 'Valet'];

/* ───────────────────────── helpers ───────────────────────── */

function distanceMeters(a, b) {
  // Haversine (meters)
  const toRad = (x) => (x * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const la1 = toRad(a.lat), la2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function toE164(v = '') {
  const d = String(v).replace(/\D/g, '');
  if (!d) return '';
  return d.startsWith('1') ? `+${d}` : `+1${d}`;
}

function createGuestToken() {
  // simple opaque token; swap to JWT later if needed
  return `gst_${randomUUID()}`;
}

/* ───────────────────────── routes ───────────────────────── */

router.get('/ping', (_req, res) => res.json({ pong: true }));

/**
 * GET /guest/properties/:hotelId/departments
 * Returns enabled department list for a hotel.
 */
router.get('/properties/:hotelId/departments', async (req, res) => {
  const { hotelId } = req.params;
  const supabaseAdmin = req.app?.locals?.supabaseAdmin;
  if (!supabaseAdmin) return res.status(500).json({ error: 'supabase_not_initialized' });

  try {
    // 1) department_settings.enabled = true
    const { data: depRows, error: depErr } = await supabaseAdmin
      .from('department_settings')
      .select('department, enabled')
      .eq('hotel_id', hotelId)
      .eq('enabled', true);

    if (depErr) throw depErr;

    let departments = (depRows || []).map((r) => r.department);

    // 2) fallback to hotels.departments_enabled (array)
    if (!departments.length) {
      const { data: hotel, error: hotelErr } = await supabaseAdmin
        .from('hotels')
        .select('departments_enabled')
        .eq('id', hotelId)
        .single();

      if (hotelErr) throw hotelErr;

      if (Array.isArray(hotel?.departments_enabled) && hotel.departments_enabled.length) {
        departments = hotel.departments_enabled;
      }
    }

    // 3) final fallback
    if (!departments.length) {
      departments = DEFAULT_DEPTS;
    }

    return res.json({ departments });
  } catch (err) {
    console.error('[GET /guest/properties/:hotelId/departments] error:', err);
    return res.status(200).json({ departments: DEFAULT_DEPTS });
  }
});

/**
 * POST /guest/start
 * Body: { name?, phone, propertyCode, lat, lng }
 *  - propertyCode must match hotels.guest_code
 * Returns:
 *  {
 *    authorized: boolean,
 *    hotel_id?, distance_m?, radius_m?, expires_at?, reason?,
 *    token?, popt?
 *  }
 */
router.post('/start', async (req, res) => {
  try {
    const { name, phone, propertyCode, lat, lng } = req.body || {};
    const supabase = req.app?.locals?.supabase;           // anon
    const supabaseAdmin = req.app?.locals?.supabaseAdmin; // service role

    if (!supabase || !supabaseAdmin) {
      return res.status(500).json({ error: 'supabase_not_initialized' });
    }

    const e164 = toE164(phone);
    if (!e164) return res.status(400).json({ error: 'invalid_phone' });
    if (!propertyCode?.trim()) return res.status(400).json({ error: 'missing_property_code' });
    if (typeof lat !== 'number' || typeof lng !== 'number') {
      return res.status(400).json({ error: 'missing_coords' });
    }

    // Lookup by guest_code in hotels
    const { data: hotel, error: hErr } = await supabase
      .from('hotels')
      .select('id, guest_code, latitude, longitude, is_active')
      .eq('guest_code', propertyCode.trim())
      .maybeSingle();

    if (hErr) {
      console.error('[guest/start] hotels lookup error:', hErr);
      return res.status(500).json({ error: 'db_error' });
    }
    if (!hotel || hotel.is_active === false) {
      return res.status(404).json({ error: 'hotel_not_found' });
    }

    const radius = DEFAULT_GEOFENCE_METERS; // default ~1 mile
    const distance = distanceMeters(
      { lat, lng },
      { lat: Number(hotel.latitude), lng: Number(hotel.longitude) }
    );
    if (Number.isNaN(distance)) return res.status(400).json({ error: 'invalid_coords' });

    if (distance > radius) {
      return res.status(200).json({
        authorized: false,
        reason: 'outside_radius',
        distance_m: Math.round(distance),
        radius_m: radius,
      });
    }

    // Authorize phone for 24h (phone is PK in authorized_numbers)
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const upsertRow = {
      phone: e164,
      hotel_id: hotel.id,
      is_staff: false,
      expires_at: expiresAt,
      // room_number: null,
    };

    const { error: aErr } = await supabase
      .from('authorized_numbers')
      .upsert(upsertRow, { onConflict: 'phone' });

    if (aErr) {
      // don't block authorization on bookkeeping problems
      console.error('[guest/start] authorized_numbers upsert error:', aErr);
    }

    // Create a guest session token for the app
    const token = createGuestToken();
    const { error: sErr } = await supabaseAdmin
      .from('guest_sessions')
      .insert([{
        token,
        hotel_id: hotel.id,
        room_number: null,
        phone_number: e164,
        expires_at: expiresAt,
      }]);

    if (sErr) {
      console.error('[guest/start] guest_sessions insert error:', sErr);
      // continue; token just won’t validate server-side if you later check it strictly
    }

    return res.status(200).json({
      authorized: true,
      hotel_id: hotel.id,
      expires_at: expiresAt,
      distance_m: Math.round(distance),
      radius_m: radius,
      token,       // used by PresenceGate → RequestChat
      popt: '',    // reserved header if your API expects it
    });
  } catch (e) {
    console.error('POST /guest/start error:', e);
    return res.status(500).json({ error: 'server_error' });
  }
});

export default router;
