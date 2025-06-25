import { supabase } from './supabaseClient';

export async function handleSMSAuthorization(incomingPhone) {
  const now = new Date().toISOString();

  // Check if already authorized
  const { data: existing } = await supabase
    .from('authorized_numbers')
    .select('*')
    .eq('phone', incomingPhone)
    .lte('expires_at', now);

  if (existing && existing.length > 0) return { allowed: true };

  // Not authorized — try to pair with active room
  const { data: rooms } = await supabase
    .from('room_device_slots')
    .select('*');

  for (const room of rooms) {
    const { data: authorized } = await supabase
      .from('authorized_numbers')
      .select('*')
      .eq('room_number', room.room_number)
      .lte('expires_at', now);

    if (authorized && authorized.length > 0 && room.current_count < room.max_devices) {
      await supabase.from('authorized_numbers').insert({
        phone: incomingPhone,
        room_number: room.room_number,
        expires_at: authorized[0].expires_at,
      });

      await supabase
        .from('room_device_slots')
        .update({ current_count: room.current_count + 1 })
        .eq('room_number', room.room_number);

      return { allowed: true };
    }
  }

  return { allowed: false };
}
