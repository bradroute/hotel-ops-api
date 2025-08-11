// src/routes/guest.js
import express from 'express';
const router = express.Router();

const DEFAULT_GEOFENCE_METERS = Number(process.env.GEOFENCE_METERS || 1609); // ~1 mile

// Haversine (meters)
function distanceMeters(a, b) {
  const toRad = (x) => (x * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const la1 = toRad(a.lat), la2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function toE164(v = '') {
  const d = String(v).replace(/\D/g, '');
  if (!d) return '';
  return d.startsWith('1') ? `+${d}` : `+1${d}`;
}

router.get('/ping', (_req, res) => res.json({ pong: true }));

/**
 * GET /guest/properties/:hotelId/departments
 * Returns only active departments for a given hotel.
 */
router.get('/properties/:hotelId/departments', async (req, res) => {
  try {
    const { hotelId } = req.params;
    const supabaseAdmin = req.app?.locals?.supabaseAdmin;

    if (!supabaseAdmin) {
      return res.status(500).json({ error: 'supabase_not_initialized' });
    }

    const { data, error } = await supabaseAdmin
      .from('department_settings')
      .select('department')
      .eq('hotel_id', hotelId)
      .eq('is_active', true);

    if (error) {
      console.error('[guest] fetch departments error:', error);
      return res.status(500).json({ error: 'db_error' });
    }

    const departments = (data || []).map((row) => row.department);
    return res.json({ departments });
  } catch (err) {
    console.error('[guest] /properties/:hotelId/departments error:', err);
    res.status(500).json({ error: 'server_error' });
  }
});

/**
 * POST /guest/start
 * Body: { name?, phone, propertyCode, lat, lng }
 * - propertyCode must match hotels.guest_code
 * Returns:
 * { authorized: boolean, hotel_id?, distance_m?, radius_m?, expires_at?, reason? }
 */
router.post('/start', async (req, res) => {
  try {
    const { name, phone, propertyCode, lat, lng } = req.body || {};
    const supabase = req.app?.locals?.supabase;

    if (!supabase) return res.status(500).json({ error: 'supabase_not_initialized' });

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

    const radius = DEFAULT_GEOFENCE_METERS;
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

    // Authorize phone for 24h
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    const upsertRow = {
      phone: e164,
      hotel_id: hotel.id,
      is_staff: false,
      expires_at: expiresAt,
    };

    const { error: aErr } = await supabase
      .from('authorized_numbers')
      .upsert(upsertRow, { onConflict: 'phone' });

    if (aErr) {
      console.error('[guest/start] authorized_numbers upsert error:', aErr);
    }

    return res.status(200).json({
      authorized: true,
      hotel_id: hotel.id,
      expires_at: expiresAt,
      distance_m: Math.round(distance),
      radius_m: radius,
    });
  } catch (e) {
    console.error('POST /guest/start error:', e);
    return res.status(500).json({ error: 'server_error' });
  }
});

export default router;
