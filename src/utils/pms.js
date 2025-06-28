// src/utils/pms.js
import { supabaseAdmin } from '../services/supabaseService.js';

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
      console.error('❌ Missing hotel_id for check-in:', { phone, room });
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
    if (authErr) console.error('❌ Error upserting authorized_numbers:', authErr);
    else console.log('➕ authorized_numbers upserted for', phone, authData);

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
    if (slotErr) console.error('❌ Error upserting room_device_slots:', slotErr);
    else console.log('↗️ room_device_slots upserted for room', room, slotData);
  }
}
