// src/services/supabaseService.js

const { createClient } = require('@supabase/supabase-js');
const { supabaseUrl, supabaseKey } = require('../config');

// Initialize Supabase client
const supabase = createClient(supabaseUrl, supabaseKey);

/**
 * Fetch all requests, ordered by creation date descending.
 */
async function getAllRequests() {
  const { data, error } = await supabase
    .from('HotelCrosbyRequests')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data;
}

/**
 * Insert a new request with the given details.
 * Returns the inserted row.
 */
async function insertRequest({ from, message, department, priority, telnyx_id }) {
  const { data, error } = await supabase
    .from('HotelCrosbyRequests')
    .insert([{ from, message, department, priority, telnyx_id }])
    .select();

  if (error) throw error;
  return data[0];
}

/**
 * Lookup a request by its Telnyx ID (to avoid duplicates).
 */
async function findByTelnyxId(telnyx_id) {
  const { data, error } = await supabase
    .from('HotelCrosbyRequests')
    .select('id')
    .eq('telnyx_id', telnyx_id)
    .maybeSingle();

  if (error) throw error;
  return data; // either null or { id: ... }
}

/**
 * Mark a request as acknowledged, setting acknowledged=true and acknowledged_at timestamp.
 * Returns the updated row.
 */
async function acknowledgeRequestById(id) {
  const { data, error } = await supabase
    .from('HotelCrosbyRequests')
    .update({
      acknowledged: true,
      acknowledged_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select();

  if (error) throw error;
  return data[0];
}

/**
 * Mark a request as completed, setting completed=true and completed_at timestamp.
 * Returns the updated row.
 */
async function completeRequestById(id) {
  const { data, error } = await supabase
    .from('HotelCrosbyRequests')
    .update({
      completed: true,
      completed_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select();

  if (error) throw error;
  return data[0];
}

/**
 * Get analytics summary: counts of today/this week/this month.
 */
async function getAnalyticsSummary() {
  const now = new Date();
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);

  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - now.getDay()); // Sunday
  startOfWeek.setHours(0, 0, 0, 0);

  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const [todayCount, weekCount, monthCount] = await Promise.all([
    supabase
      .from('HotelCrosbyRequests')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', startOfToday.toISOString()),

    supabase
      .from('HotelCrosbyRequests')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', startOfWeek.toISOString()),

    supabase
      .from('HotelCrosbyRequests')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', startOfMonth.toISOString()),
  ]);

  return {
    today: todayCount.count,
    this_week: weekCount.count,
    this_month: monthCount.count,
  };
}

/**
 * Get counts by department.
 */
async function getAnalyticsByDepartment() {
  const { data, error } = await supabase
    .from('HotelCrosbyRequests')
    .select('department');

  if (error) throw error;

  const result = {};
  data.forEach((row) => {
    const dept = row.department || 'unknown';
    result[dept] = (result[dept] || 0) + 1;
  });

  return result;
}

/**
 * Get average response time (in minutes) for all acknowledged requests.
 */
async function getAnalyticsAvgResponseTime() {
  const { data, error } = await supabase
    .from('HotelCrosbyRequests')
    .select('created_at, acknowledged_at')
    .eq('acknowledged', true);

  if (error) throw error;

  const diffsInMinutes = data
    .filter((row) => row.created_at && row.acknowledged_at)
    .map((row) => {
      const created = new Date(row.created_at);
      const acked = new Date(row.acknowledged_at);
      return (acked - created) / (1000 * 60);
    });

  const avg =
    diffsInMinutes.length > 0
      ? diffsInMinutes.reduce((a, b) => a + b, 0) / diffsInMinutes.length
      : 0;

  return { average_response_time_minutes: parseFloat(avg.toFixed(2)) };
}

/**
 * Get daily average response times for the past 7 days via a Supabase RPC.
 */
async function getAnalyticsDailyResponseTimes() {
  const { data, error } = await supabase.rpc('get_avg_response_times_last_7_days');
  if (error) throw error;
  return data;
}

module.exports = {
  getAllRequests,
  insertRequest,
  findByTelnyxId,
  acknowledgeRequestById,
  completeRequestById,
  getAnalyticsSummary,
  getAnalyticsByDepartment,
  getAnalyticsAvgResponseTime,
  getAnalyticsDailyResponseTimes,
};
