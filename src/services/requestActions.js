// src/services/requestActions.js
import { supabaseAdmin } from './supabaseService.js';
import { notifyGuestOnStatus } from './notificationService.js';

async function markAndFetch(id, hotelId, patch) {
  let q = supabaseAdmin
    .from('requests')
    .update(patch)
    .eq('id', id)
    .eq('cancelled', false);

  if (patch.acknowledged) q = q.eq('acknowledged', false);
  if (patch.completed)    q = q.eq('completed', false);
  if (hotelId)            q = q.eq('hotel_id', hotelId);

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
  if (!data) throw new Error('Request not found or already in target state.');

  return data;
}

async function insertAudit(requestId, hotelId, action) {
  // Optional audit table; ignore if table not present.
  await supabaseAdmin
    .from('request_events')
    .insert({
      request_id: requestId,
      hotel_id: hotelId,
      action,                    // 'acknowledged' | 'completed'
      created_at: new Date().toISOString(),
      actor: 'system',           // or staff user id if available
    })
    .catch(() => {});
}

/**
 * Mark a request acknowledged and notify the guest via the proper channel.
 * - SMS-originated → SMS only
 * - App-originated → Push only
 */
export async function acknowledgeRequestById(id, hotelId) {
  const row = await markAndFetch(id, hotelId, {
    acknowledged: true,
    acknowledged_at: new Date().toISOString(),
  });

  insertAudit(row.id, row.hotel_id, 'acknowledged').catch(() => {});
  notifyGuestOnStatus(row, 'acknowledged').catch((e) =>
    console.error('[requestActions] notifyGuestOnStatus(ack) failed:', e)
  );

  return row;
}

/**
 * Mark a request completed and notify the guest via the proper channel.
 * - SMS-originated → SMS only
 * - App-originated → Push only
 */
export async function completeRequestById(id, hotelId) {
  const row = await markAndFetch(id, hotelId, {
    completed: true,
    completed_at: new Date().toISOString(),
  });

  insertAudit(row.id, row.hotel_id, 'completed').catch(() => {});
  notifyGuestOnStatus(row, 'completed').catch((e) =>
    console.error('[requestActions] notifyGuestOnStatus(complete) failed:', e)
  );

  return row;
}
