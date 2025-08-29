// src/services/requestActions.js
import { supabase } from './supabaseService.js';

/**
 * Mark a request acknowledged.
 * NOTE: This function NO LONGER sends guest notifications.
 *       The caller (route) is responsible for calling notifyGuestOnStatus().
 */
export async function acknowledgeRequestById(id, hotelId) {
  let q = supabase
    .from('requests')
    .update({
      acknowledged: true,
      acknowledged_at: new Date().toISOString(),
    })
    .eq('id', id);

  if (hotelId) q = q.eq('hotel_id', hotelId);

  const { data, error } = await q
    .select(
      'id, hotel_id, app_account_id, from_phone, message, department, priority, acknowledged, acknowledged_at, completed, completed_at'
    )
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data;
}

/**
 * Mark a request completed.
 * NOTE: This function NO LONGER sends guest notifications.
 *       The caller (route) is responsible for calling notifyGuestOnStatus().
 */
export async function completeRequestById(id, hotelId) {
  let q = supabase
    .from('requests')
    .update({
      completed: true,
      completed_at: new Date().toISOString(),
    })
    .eq('id', id);

  if (hotelId) q = q.eq('hotel_id', hotelId);

  const { data, error } = await q
    .select(
      'id, hotel_id, app_account_id, from_phone, message, department, priority, acknowledged, acknowledged_at, completed, completed_at'
    )
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data;
}
