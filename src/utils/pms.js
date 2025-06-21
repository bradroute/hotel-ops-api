import { supabase } from './supabaseClient';

export async function syncCheckIns(fakeCheckIns) {
  for (const checkIn of fakeCheckIns) {
    const { phone, room, checkout } = checkIn;

    await supabase.from('authorized_numbers').upsert({
      phone,
      room_number: room,
      expires_at: checkout,
    });

    await supabase.from('room_device_slots').upsert({
      room_number: room,
      max_devices: 4,
      current_count: 1,
    });
  }
}
