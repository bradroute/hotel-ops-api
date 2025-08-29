// src/services/requestActions.js
import { supabase } from './supabaseService.js';
import { notifyGuestOnStatus } from './notificationService.js';

/**
 * Mark a request acknowledged.
 * If hotelId is provided, scope the update to that property.
 * @param {string|number} id
 * @param {string|number} [hotelId]
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

  const { data, error } = await q.select('*').maybeSingle();
  if (error) throw new Error(error.message);

  // Fire guest notification (non-blocking)
  if (data) {
    notifyGuestOnStatus(data, 'acknowledged').catch((e) =>
      console.error('notifyGuestOnStatus(ack) failed', e)
    );
  }
  return data;
}

/**
 * Mark a request completed.
 * If hotelId is provided, scope the update to that property.
 * @param {string|number} id
 * @param {string|number} [hotelId]
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

  const { data, error } = await q.select('*').maybeSingle();
  if (error) throw new Error(error.message);

  // Fire guest notification (non-blocking)
  if (data) {
    notifyGuestOnStatus(data, 'completed').catch((e) =>
      console.error('notifyGuestOnStatus(complete) failed', e)
    );
  }
  return data;
}
