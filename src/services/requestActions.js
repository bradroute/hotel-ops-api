// src/services/requestActions.js
import { supabaseAdmin as supabase } from './supabaseService.js';
import {
  notifyGuestOnAcknowledged,
  notifyGuestOnCompleted,
} from './notificationService.js';

/**
 * Fetch a request row safely.
 */
async function getRequestById(id, hotel_id) {
  const q = supabase
    .from('requests')
    .select('*')
    .eq('id', id)
    .limit(1);

  if (hotel_id) q.eq('hotel_id', hotel_id);

  const { data, error } = await q.maybeSingle();
  if (error) throw error;
  return data || null;
}

/**
 * Record an audit event.
 */
async function insertEvent(request_id, hotel_id, action, actor = 'system') {
  try {
    await supabase.from('request_events').insert({
      request_id,
      hotel_id,
      action, // 'acknowledged' | 'completed' | 'created' | 'cancelled'
      actor,
    });
  } catch (e) {
    console.warn('[events] insert failed:', e?.message || e);
  }
}

/**
 * Acknowledge a request (idempotent-ish).
 * - Sets acknowledged=true and acknowledged_at (if not already set)
 * - Emits request_events row
 * - Notifies guest via SMS helper (uses telnyx_numbers DID under the hood)
 */
export async function acknowledgeRequestById(id, hotel_id, actor = 'dashboard') {
  console.log('▶️ acknowledgeRequestById', { id, hotel_id });

  const row = await getRequestById(id, hotel_id);
  if (!row) {
    console.warn('ack: not found', id);
    return null;
  }
  if (row.cancelled) {
    console.warn('ack: already cancelled', id);
    return null;
  }

  let patch = {};
  if (!row.acknowledged) {
    patch.acknowledged = true;
    patch.acknowledged_at = new Date().toISOString();
  }

  if (Object.keys(patch).length === 0) {
    console.log('ack: already acknowledged, skipping update', id);
  } else {
    const { data: updated, error } = await supabase
      .from('requests')
      .update(patch)
      .eq('id', id)
      .select('*')
      .single();
    if (error) throw error;
    Object.assign(row, updated); // keep latest state
    console.log('✅ ack: updated', { id: row.id, acknowledged_at: row.acknowledged_at });
  }

  await insertEvent(row.id, row.hotel_id, 'acknowledged', actor);

  // Notify guest (safe if from_phone missing)
  try {
    await notifyGuestOnAcknowledged(row);
  } catch (e) {
    console.error('[ack] guest notify failed:', e?.message || e);
  }

  return row;
}

/**
 * Complete a request.
 * - Sets completed=true and completed_at (if not already set)
 * - Emits request_events row
 * - Notifies guest via SMS helper (uses telnyx_numbers DID)
 */
export async function completeRequestById(id, hotel_id, actor = 'dashboard') {
  console.log('▶️ completeRequestById', { id, hotel_id });

  const row = await getRequestById(id, hotel_id);
  if (!row) {
    console.warn('complete: not found', id);
    return null;
  }
  if (row.cancelled) {
    console.warn('complete: already cancelled', id);
    return null;
  }
  if (row.completed) {
    console.log('complete: already completed, no-op', id);
    return row;
  }

  const patch = {
    completed: true,
    completed_at: new Date().toISOString(),
  };

  const { data: updated, error } = await supabase
    .from('requests')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw error;

  console.log('✅ complete: updated', { id: updated.id, completed_at: updated.completed_at });

  await insertEvent(updated.id, updated.hotel_id, 'completed', actor);

  // Notify guest
  try {
    await notifyGuestOnCompleted(updated);
  } catch (e) {
    console.error('[complete] guest notify failed:', e?.message || e);
  }

  return updated;
}
