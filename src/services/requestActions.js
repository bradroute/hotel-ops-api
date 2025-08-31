// src/services/requestActions.js
import { supabaseAdmin } from './supabaseService.js';

/**
 * Mark a request acknowledged.
 * NOTE: This function does NOT send guest notifications.
 *       Caller must invoke notifyGuestOnStatus(row, 'acknowledged').
 */
export async function acknowledgeRequestById(id, hotelId) {
  let q = supabaseAdmin
    .from('requests')
    .update({
      acknowledged: true,
      acknowledged_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('acknowledged', false)   // avoid double-acks
    .eq('cancelled', false);     // don’t ack cancelled

  if (hotelId) q = q.eq('hotel_id', hotelId);

  const { data, error } = await q
    .select(`
      id, hotel_id, app_account_id, from_phone,
      message, department, priority,
      acknowledged, acknowledged_at,
      completed, completed_at, cancelled
    `)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new Error('Request not found or already acknowledged/cancelled.');
  return data;
}

/**
 * Mark a request completed.
 * NOTE: This function does NOT send guest notifications.
 *       Caller must invoke notifyGuestOnStatus(row, 'completed').
 */
export async function completeRequestById(id, hotelId) {
  let q = supabaseAdmin
    .from('requests')
    .update({
      completed: true,
      completed_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('completed', false)      // avoid double-complete
    .eq('cancelled', false);     // don’t complete cancelled

  if (hotelId) q = q.eq('hotel_id', hotelId);

  const { data, error } = await q
    .select(`
      id, hotel_id, app_account_id, from_phone,
      message, department, priority,
      acknowledged, acknowledged_at,
      completed, completed_at, cancelled
    `)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new Error('Request not found or already completed/cancelled.');
  return data;
}
