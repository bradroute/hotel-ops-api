// src/services/requestActions.js
import { supabaseAdmin as supabase } from './supabaseService.js';
import {
  notifyGuestOnAcknowledged,
  notifyGuestOnCompleted,
} from './notificationService.js';
import logger from '../lib/logger.js';

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
    logger.warn({ err: e }, 'event insert failed');
  }
}

/**
 * Acknowledge a request (idempotent-ish).
 * - Sets acknowledged=true and acknowledged_at (if not already set)
 * - Emits request_events row
 * - Notifies guest via SMS helper (uses telnyx_numbers DID under the hood)
 */
export async function acknowledgeRequestById(id, hotel_id, actor = 'dashboard') {
  logger.info({ id, hotel_id }, 'acknowledgeRequestById');

  const row = await getRequestById(id, hotel_id);
  if (!row) {
    logger.warn({ id }, 'ack: not found');
    return null;
  }
  if (row.cancelled) {
    logger.warn({ id }, 'ack: already cancelled');
    return null;
  }

  let patch = {};
  if (!row.acknowledged) {
    patch.acknowledged = true;
    patch.acknowledged_at = new Date().toISOString();
  }

  if (Object.keys(patch).length === 0) {
    logger.info({ id }, 'ack: already acknowledged, skipping update');
  } else {
    const { data: updated, error } = await supabase
      .from('requests')
      .update(patch)
      .eq('id', id)
      .select('*')
      .single();
    if (error) throw error;
    Object.assign(row, updated); // keep latest state
    logger.info({ id: row.id, acknowledged_at: row.acknowledged_at }, 'ack: updated');
  }

  await insertEvent(row.id, row.hotel_id, 'acknowledged', actor);

  // Notify guest (safe if from_phone missing)
  try {
    await notifyGuestOnAcknowledged(row);
  } catch (e) {
    logger.error({ err: e }, 'ack guest notify failed');
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
  logger.info({ id, hotel_id }, 'completeRequestById');

  const row = await getRequestById(id, hotel_id);
  if (!row) {
    logger.warn({ id }, 'complete: not found');
    return null;
  }
  if (row.cancelled) {
    logger.warn({ id }, 'complete: already cancelled');
    return null;
  }
  if (row.completed) {
    logger.info({ id }, 'complete: already completed, no-op');
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

  logger.info({ id: updated.id, completed_at: updated.completed_at }, 'complete: updated');

  await insertEvent(updated.id, updated.hotel_id, 'completed', actor);

  // Notify guest
  try {
    await notifyGuestOnCompleted(updated);
  } catch (e) {
    logger.error({ err: e }, 'complete guest notify failed');
  }

  return updated;
}
