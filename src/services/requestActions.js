// src/services/requestActions.js

import { supabase } from './supabaseService.js';

export async function acknowledgeRequestById(id) {
  const { data, error } = await supabase
    .from('requests')
    .update({ acknowledged: true, acknowledged_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')  // ✅ Select full row after update
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

export async function completeRequestById(id) {
  const { data, error } = await supabase
    .from('requests')
    .update({ completed: true, completed_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')  // ✅ Select full row after update
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

