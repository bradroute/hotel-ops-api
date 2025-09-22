// src/routes/rooms.js
import express from 'express';
import { supabaseAdmin } from '../services/supabaseService.js';

const router = express.Router();

const DEFAULT_MAX_DEVICES = Number(process.env.ROOM_MAX_DEVICES || 4);

/* Helpers */
function toE164(v = '') {
  const d = String(v).replace(/\D/g, '');
  if (!d) return '';
  return d.startsWith('1') ? `+${d}` : `+1${d}`;
}
function isIsoFuture(ts) {
  const t = new Date(ts);
  return !Number.isNaN(+t) && t.getTime() > Date.now() - 60_000; // allow small clock skew
}

/**
 * Guest check-in: authorize the primary guest and reset the slot count to 1.
 *
 * POST /rooms/:room_number/checkin
 * Body: {
 *   phone: string,       // guest’s phone number
 *   checkout: string,    // ISO timestamp of checkout
 *   hotel_id: string     // hotel’s UUID
 * }
 */
router.post('/:room_number/checkin', async (req, res) => {
  const room_number = String(req.params.room_number || '').trim();
  const { phone, checkout, hotel_id } = req.body || {};

  const e164 = toE164(phone);
  if (!e164) return res.status(400).json({ error: 'Invalid or missing phone' });
  if (!hotel_id) return res.status(400).json({ error: 'Missing hotel_id' });
  if (!room_number) return res.status(400).json({ error: 'Missing room_number' });
  if (!isIsoFuture(checkout)) return res.status(400).json({ error: 'Invalid checkout timestamp (ISO, future)' });

  try {
    // 1) Upsert the primary guest into authorized_numbers (composite onConflict)
    const { error: authErr } = await supabaseAdmin
      .from('authorized_numbers')
      .upsert(
        {
          phone: e164,
          room_number,
          expires_at: checkout,
          hotel_id,
          is_staff: false,
        },
        { onConflict: 'phone,hotel_id' }
      );

    if (authErr) throw authErr;

    // 2) Upsert/reset the slot record to current_count=1
    const { data: slot, error: slotErr } = await supabaseAdmin
      .from('room_device_slots')
      .upsert(
        {
          room_number,
          hotel_id,
          max_devices: DEFAULT_MAX_DEVICES,
          current_count: 1,
        },
        { onConflict: 'room_number,hotel_id' }
      )
      .select('room_number,hotel_id,max_devices,current_count')
      .maybeSingle();

    if (slotErr) throw slotErr;

    return res.status(200).json({
      success: true,
      room_number,
      hotel_id,
      current_count: slot?.current_count ?? 1,
      max_devices: slot?.max_devices ?? DEFAULT_MAX_DEVICES,
      authorized_phone: e164,
      checkout,
    });
  } catch (err) {
    console.error('❌ Check-in error:', err);
    return res.status(500).json({ error: 'checkin_failed', details: err.message || String(err) });
  }
});

/**
 * Guest check-out: clear all guest authorizations for the room and reset slot count to 0.
 *
 * POST /rooms/:room_number/checkout
 * Body: { hotel_id: string }
 */
router.post('/:room_number/checkout', async (req, res) => {
  const room_number = String(req.params.room_number || '').trim();
  const { hotel_id } = req.body || {};

  if (!hotel_id) return res.status(400).json({ error: 'Missing hotel_id' });
  if (!room_number) return res.status(400).json({ error: 'Missing room_number' });

  try {
    // 1) Remove all guest (non-staff) authorizations for this room
    const { error: authErr } = await supabaseAdmin
      .from('authorized_numbers')
      .delete()
      .match({ room_number, hotel_id, is_staff: false });

    if (authErr) throw authErr;

    // 2) Reset the slot count to zero
    const { data: slot, error: updateErr } = await supabaseAdmin
      .from('room_device_slots')
      .upsert(
        {
          room_number,
          hotel_id,
          current_count: 0,
          max_devices: DEFAULT_MAX_DEVICES, // keep consistent default if newly creating
        },
        { onConflict: 'room_number,hotel_id' }
      )
      .select('room_number,hotel_id,max_devices,current_count')
      .maybeSingle();

    if (updateErr) throw updateErr;

    return res.status(200).json({
      success: true,
      room_number,
      hotel_id,
      current_count: slot?.current_count ?? 0,
      max_devices: slot?.max_devices ?? DEFAULT_MAX_DEVICES,
      cleared_authorizations: true,
    });
  } catch (err) {
    console.error('❌ Checkout error:', err);
    return res.status(500).json({ error: 'checkout_failed', details: err.message || String(err) });
  }
});

export default router;
