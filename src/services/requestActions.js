// src/services/requestActions.js
import { supabaseAdmin } from './supabaseService.js';
import { notifyGuestOnStatus } from './notificationService.js';

/**
 * Mark a request acknowledged and notify the guest via the proper channel.
 * - SMS-originated → SMS only
 * - App-originated → Push only
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
      source,
      acknowledged, acknowledged_at,
      completed, completed_at, cancelled
    `)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new Error('Request not found or already acknowledged/cancelled.');

  // Fire-and-forget guest notification; do not block the HTTP response.
  notifyGuestOnStatus(data, 'acknowledged').catch((e) =>
    console.error('[requestActions] notifyGuestOnStatus(ack) failed:', e)
  );

  return data;
}

/**
 * Mark a request completed and notify the guest via the proper channel.
 * - SMS-originated → SMS only
 * - App-originated → Push only
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
      source,
      acknowledged, acknowledged_at,
      completed, completed_at, cancelled
    `)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new Error('Request not found or already completed/cancelled.');

  // Fire-and-forget guest notification; do not block the HTTP response.
  notifyGuestOnStatus(data, 'completed').catch((e) =>
    console.error('[requestActions] notifyGuestOnStatus(complete) failed:', e)
  );

  return data;
}
