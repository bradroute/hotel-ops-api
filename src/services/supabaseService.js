// hotel-ops-api/src/services/supabaseService.js

const { createClient } = require('@supabase/supabase-js');
const { supabaseUrl, supabaseKey } = require('../config');

// Initialize the Supabase client
const supabase = createClient(supabaseUrl, supabaseKey);

/**
 * Fetch all requests, optionally scoped to a hotel_id
 * @param {string} [hotelId] - UUID of the hotel to filter by
 */
async function getAllRequests(hotelId) {
  let query = supabase
    .from('requests')
    .select('*')
    .order('created_at', { ascending: false });

  if (hotelId) {
    query = query.eq('hotel_id', hotelId);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(error.message);
  }
  return data;
}

/**
 * Insert a new request, scoped to a hotel
 * @param {object} params
 * @param {string} params.hotel_id
 * @param {string} params.from
 * @param {string} params.message
 * @param {string} params.department
 * @param {string} params.priority
 * @param {string} params.telnyx_id
 */
async function insertRequest({ hotel_id, from, message, department, priority, telnyx_id }) {
  const { data, error } = await supabase
    .from('requests')
    .insert([{ hotel_id, from, message, department, priority, telnyx_id }])
    .select();

  if (error) {
    throw new Error(error.message);
  }
  return data[0];
}

/**
 * Find a request by its Telnyx message ID
 * @param {string} telnyx_id
 */
async function findByTelnyxId(telnyx_id) {
  const { data, error } = await supabase
    .from('requests')
    .select('id')
    .eq('telnyx_id', telnyx_id)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }
  return data;
}

/**
 * Mark a request as acknowledged
 * @param {string} id
 */
async function acknowledgeRequestById(id) {
  const { data, error } = await supabase
    .from('requests')
    .update({
      acknowledged: true,
      acknowledged_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select();

  if (error) {
    throw new Error(error.message);
  }
  return data[0];
}

/**
 * Mark a request as completed
 * @param {string} id
 */
async function completeRequestById(id) {
  const { data, error } = await supabase
    .from('requests')
    .update({
      completed: true,
      completed_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select();

  if (error) {
    throw new Error(error.message);
  }
  return data[0];
}

/**
 * Get summary analytics (counts) for all time buckets
 */
async function getAnalyticsSummary() {
  const now = new Date();
  const startOfToday = new Date(now.setHours(0, 0, 0, 0));
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - now.getDay());
  startOfWeek.setHours(0, 0, 0, 0);
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const [todayCount, weekCount, monthCount] = await Promise.all([
    supabase
      .from('requests')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', startOfToday.toISOString()),
    supabase
      .from('requests')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', startOfWeek.toISOString()),
    supabase
      .from('requests')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', startOfMonth.toISOString()),
  ]);

  if (todayCount.error) throw new Error(todayCount.error.message);
  if (weekCount.error)  throw new Error(weekCount.error.message);
  if (monthCount.error) throw new Error(monthCount.error.message);

  return {
    today:      todayCount.count,
    this_week:  weekCount.count,
    this_month: monthCount.count,
  };
}

/**
 * Get count of requests grouped by department
 */
async function getAnalyticsByDepartment() {
  const { data, error } = await supabase
    .from('requests')
    .select('department');

  if (error) {
    throw new Error(error.message);
  }

  return data.reduce((acc, row) => {
    const dept = row.department || 'unknown';
    acc[dept] = (acc[dept] || 0) + 1;
    return acc;
  }, {});
}

/**
 * Get average response time (request → acknowledged) in minutes
 */
async function getAnalyticsAvgResponseTime() {
  const { data, error } = await supabase
    .from('requests')
    .select('created_at, acknowledged_at')
    .eq('acknowledged', true);

  if (error) {
    throw new Error(error.message);
  }

  const diffs = data
    .filter((r) => r.created_at && r.acknowledged_at)
    .map((r) => (new Date(r.acknowledged_at) - new Date(r.created_at)) / 60000);

  const avg = diffs.length
    ? diffs.reduce((sum, d) => sum + d, 0) / diffs.length
    : 0;

  return { average_response_time_minutes: parseFloat(avg.toFixed(2)) };
}

/**
 * RPC to get daily avg response times for the last 7 days
 */
async function getAnalyticsDailyResponseTimes() {
  const { data, error } = await supabase.rpc('get_avg_response_times_last_7_days');
  if (error) {
    throw new Error(error.message);
  }
  return data;
}

module.exports = {
  supabase,
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
