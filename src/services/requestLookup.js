// src/services/requestLookup.js
import { supabase } from './supabaseService.js';

/**
 * Return true if a request with this Telnyx id already exists.
 * Uses the unique index on requests.telnyx_id for safety.
 */
export async function findByTelnyxId(telnyx_id) {
  if (!telnyx_id) return null;
  const { data, error } = await supabase
    .from('requests')
    .select('id')
    .eq('telnyx_id', telnyx_id)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data;
}
