// hotel-ops-api/src/services/supabaseService.js

const { createClient } = require('@supabase/supabase-js');
const { supabaseUrl, supabaseKey } = require('../config');

const supabase = createClient(supabaseUrl, supabaseKey);

async function getAllRequests() {
  const { data, error } = await supabase
    .from('HotelCrosbyRequests')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(error.message);
  }
  return data;
}

async function insertRequest({ from, message, department, priority, telnyx_id }) {
  const { data, error } = await supabase
    .from('HotelCrosbyRequests')
    .insert([{ from, message, department, priority, telnyx_id }])
    .select();

  if (error) {
    throw new Error(error.message);
  }
  return data[0];
}

async function findByTelnyxId(telnyx_id) {
  const { data, error } = await supabase
    .from('HotelCrosbyRequests')
    .select('id')
    .eq('telnyx_id', telnyx_id)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }
  return data;
}

async function acknowledgeRequestById(id) {
  const { data, error } = await supabase
    .from('HotelCrosbyRequests')
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

async function completeRequestById(id) {
  const { data, error } = await supabase
    .from('HotelCrosbyRequests')
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

async function getAnalyticsSummary() {
  const now = new Date();
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);

  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - now.getDay()); // Sunday
  startOfWeek.setHours(0, 0, 0, 0);

  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  // Run all three count‐queries in parallel
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

  // Throw if any of the three calls returned an error
  if (todayCount.error) {
    throw new Error(todayCount.error.message);
  }
  if (weekCount.error) {
    throw new Error(weekCount.error.message);
  }
  if (monthCount.error) {
    throw new Error(monthCount.error.message);
  }

  return {
    today: todayCount.count,
    this_week: weekCount.count,
    this_month: monthCount.count,
  };
}

async function getAnalyticsByDepartment() {
  const { data, error } = await supabase
    .from('HotelCrosbyRequests')
    .select('department');

  if (error) {
    throw new Error(error.message);
  }

  const result = {};
  data.forEach((row) => {
    const dept = row.department || 'unknown';
    result[dept] = (result[dept] || 0) + 1;
  });

  return result;
}

async function getAnalyticsAvgResponseTime() {
  const { data, error } = await supabase
    .from('HotelCrosbyRequests')
    .select('created_at, acknowledged_at')
    .eq('acknowledged', true);

  if (error) {
    throw new Error(error.message);
  }

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

async function getAnalyticsDailyResponseTimes() {
  const { data, error } = await supabase.rpc('get_avg_response_times_last_7_days');
  if (error) {
    throw new Error(error.message);
  }
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
