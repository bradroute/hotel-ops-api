import { createClient } from '@supabase/supabase-js';
import { supabaseUrl, supabaseKey } from '../config/index.js';

export const supabase = createClient(supabaseUrl, supabaseKey);

export async function getAllRequests(hotelId) {
  let query = supabase.from('requests').select('*').order('created_at', { ascending: false });
  if (hotelId) query = query.eq('hotel_id', hotelId);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data;
}

export async function insertRequest({ hotel_id, from_phone, message, department, priority, telnyx_id }) {
  const { data, error } = await supabase
    .from('requests')
    .insert([{ hotel_id, from_phone, message, department, priority, telnyx_id }])
    .select();
  if (error) throw new Error(error.message);
  return data[0];
}

export async function findByTelnyxId(telnyx_id) {
  const { data, error } = await supabase
    .from('requests')
    .select('id')
    .eq('telnyx_id', telnyx_id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

export async function acknowledgeRequestById(id) {
  const { data, error } = await supabase
    .from('requests')
    .update({ acknowledged: true, acknowledged_at: new Date().toISOString() })
    .eq('id', id)
    .select();
  if (error) throw new Error(error.message);
  return data[0];
}

export async function completeRequestById(id) {
  const { data, error } = await supabase
    .from('requests')
    .update({ completed: true, completed_at: new Date().toISOString() })
    .eq('id', id)
    .select();
  if (error) throw new Error(error.message);
  return data[0];
}

export async function getAnalyticsSummary() {
  const now = new Date();
  const startOfToday = new Date(now.setHours(0, 0, 0, 0));
  const startOfWeek = new Date(startOfToday);
  startOfWeek.setDate(startOfToday.getDate() - startOfToday.getDay());
  const startOfMonth = new Date(startOfToday.getFullYear(), startOfToday.getMonth(), 1);

  const [todayCount, weekCount, monthCount] = await Promise.all([
    supabase.from('requests').select('id', { count: 'exact', head: true }).gte('created_at', startOfToday.toISOString()),
    supabase.from('requests').select('id', { count: 'exact', head: true }).gte('created_at', startOfWeek.toISOString()),
    supabase.from('requests').select('id', { count: 'exact', head: true }).gte('created_at', startOfMonth.toISOString()),
  ]);

  if (todayCount.error) throw new Error(todayCount.error.message);
  if (weekCount.error) throw new Error(weekCount.error.message);
  if (monthCount.error) throw new Error(monthCount.error.message);

  return {
    today: todayCount.count,
    this_week: weekCount.count,
    this_month: monthCount.count,
  };
}

export async function getAnalyticsByDepartment() {
  const { data, error } = await supabase.from('requests').select('department');
  if (error) throw new Error(error.message);
  return data.reduce((acc, { department }) => {
    const dept = department || 'unknown';
    acc[dept] = (acc[dept] || 0) + 1;
    return acc;
  }, {});
}

export async function getAnalyticsAvgResponseTime() {
  const { data, error } = await supabase
    .from('requests')
    .select('created_at, acknowledged_at')
    .eq('acknowledged', true);

  if (error) throw new Error(error.message);

  const diffs = data
    .filter(r => r.created_at && r.acknowledged_at)
    .map(r => (new Date(r.acknowledged_at) - new Date(r.created_at)) / 60000);

  const avg = diffs.length ? diffs.reduce((a, b) => a + b, 0) / diffs.length : 0;
  return { average_response_time_minutes: parseFloat(avg.toFixed(2)) };
}

export async function getAnalyticsDailyResponseTimes() {
  const { data, error } = await supabase.rpc('get_avg_response_times_last_7_days');
  if (error) throw new Error(error.message);
  return data;
}
