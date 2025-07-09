// src/services/requestActions.js
import { supabase } from './supabaseService.js';

/**
 * Mark a request acknowledged, but only if it belongs to the given hotel.
 * @param {string} id - Request ID
 * @param {string} hotelId - Hotel (property) ID to scope to
 */
export async function acknowledgeRequestById(id, hotelId) {
  const { data, error } = await supabase
    .from('requests')
    .update({
      acknowledged: true,
      acknowledged_at: new Date().toISOString()
    })
    .eq('id', id)
    .eq('hotel_id', hotelId)
    .select('id, from_phone, department, priority, message, acknowledged, acknowledged_at, completed, completed_at')
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data;
}

/**
 * Mark a request completed, but only if it belongs to the given hotel.
 * @param {string} id - Request ID
 * @param {string} hotelId - Hotel (property) ID to scope to
 */
export async function completeRequestById(id, hotelId) {
  const { data, error } = await supabase
    .from('requests')
    .update({
      completed: true,
      completed_at: new Date().toISOString()
    })
    .eq('id', id)
    .eq('hotel_id', hotelId)
    .select('*')
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data;
}
