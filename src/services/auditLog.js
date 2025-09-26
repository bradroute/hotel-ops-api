// server-side only (service role)
import { supabaseAdmin } from './supabaseService.js';

export async function logRequestEvent({
  request_id,
  hotel_id,
  action,                 // 'field_changed' | 'note_added' | 'cancelled' | etc.
  from_status = null,
  to_status = null,
  from_priority = null,
  to_priority = null,
  from_department = null,
  to_department = null,
  actor_user_id = null,   // req.user?.id when available
  actor_label = 'System',
  note = null,
  metadata = {}
}) {
  const payload = {
    request_id,
    hotel_id,
    action,
    from_status,
    to_status,
    from_priority,
    to_priority,
    from_department,
    to_department,
    actor_user_id,
    actor_label,
    note,
    metadata
  };

  const { error } = await supabaseAdmin.from('request_logs').insert([payload]);
  if (error) console.error('[audit] insert failed', error, payload);
}
