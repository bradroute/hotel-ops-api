// src/routes/rooms.js
import express from 'express';
import { supabaseAdmin } from '../services/supabaseService.js';

const router = express.Router();

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
  const { room_number } = req.params;
  const { phone, checkout, hotel_id } = req.body;

  if (!phone || !checkout || !hotel_id) {
    return res.status(400).json({ error: 'Missing phone, checkout, or hotel_id' });
  }

  try {
    // 1) Upsert the primary guest into authorized_numbers
    await supabaseAdmin
      .from('authorized_numbers')
      .upsert({
        phone,
        room_number,
        expires_at: checkout,
        hotel_id,
        is_staff: false,
      });

    // 2) Upsert the slot record (reset current_count to 1)
    await supabaseAdmin
      .from('room_device_slots')
      .upsert({
        room_number,
        max_devices: 4,
        current_count: 1,
        hotel_id,
      });

    return res.status(200).json({ success: true, current_count: 1 });
  } catch (err) {
    console.error('❌ Check-in error:', err);
    return res.status(500).json({ error: 'Check-in failed', details: err });
  }
});

/**
 * Guest check-out: clear all authorizations and reset slot count to 0.
 *
 * POST /rooms/:room_number/checkout
 * Body: {
 *   hotel_id: string     // hotel’s UUID
 * }
 */
router.post('/:room_number/checkout', async (req, res) => {
  const { room_number } = req.params;
  const { hotel_id } = req.body;

  if (!hotel_id) {
    return res.status(400).json({ error: 'Missing hotel_id' });
  }

  try {
    // 1) Remove all authorizations for this room
    const { error: authErr } = await supabaseAdmin
      .from('authorized_numbers')
      .delete()
      .match({ room_number, hotel_id });
    if (authErr) throw authErr;

    // 2) Reset the slot count to zero
    const { error: updateErr } = await supabaseAdmin
      .from('room_device_slots')
      .update({ current_count: 0 })
      .match({ room_number, hotel_id });
    if (updateErr) throw updateErr;

    return res.status(200).json({ success: true, current_count: 0 });
  } catch (err) {
    console.error('❌ Checkout error:', err);
    return res.status(500).json({ error: 'Checkout failed', details: err });
  }
});

export default router;
