// src/utils/pms.js
import { supabaseAdmin } from '../services/supabaseService.js';
import logger from '../lib/logger.js';

/**
 * fakeCheckIns: Array of objects with
 *   - phone: string
 *   - room: string
 *   - checkout: ISO timestamp
 *   - hotel_id: UUID string
 */
export async function syncCheckIns(fakeCheckIns) {
  for (const { phone, room, checkout, hotel_id } of fakeCheckIns) {
    if (!hotel_id) {
      logger.error({ phone, room }, 'Missing hotel_id for check-in');
      continue;
    }

    // Upsert the primary guest
    const { data: authData, error: authErr } = await supabaseAdmin
      .from('authorized_numbers')
      .upsert({
        phone,
        room_number: room,
        expires_at: checkout,
        hotel_id,
        is_staff: false,
      })
      .select();
    if (authErr) logger.error({ err: authErr }, 'Error upserting authorized_numbers');
    else logger.info({ phone }, 'authorized_numbers upserted');

    // Upsert the slot record
    const { data: slotData, error: slotErr } = await supabaseAdmin
      .from('room_device_slots')
      .upsert({
        room_number: room,
        max_devices: 4,
        current_count: 1,
        hotel_id,
      })
      .select();
    if (slotErr) logger.error({ err: slotErr }, 'Error upserting room_device_slots');
    else logger.info({ room }, 'room_device_slots upserted');
  }
}
