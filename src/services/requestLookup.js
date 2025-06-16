import { supabase } from './supabaseService.js';

export async function findByTelnyxId(telnyx_id) {
  const { data, error } = await supabase
    .from('requests')
    .select('*')
    .eq('telnyx_id', telnyx_id)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data;
}
