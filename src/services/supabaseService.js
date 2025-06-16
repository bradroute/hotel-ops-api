// src/services/supabaseService.js

import ws from 'isomorphic-ws';
if (typeof globalThis.WebSocket === 'undefined') {
  globalThis.WebSocket = ws;
}

import { createClient } from '@supabase/supabase-js';
import { supabaseUrl, supabaseKey } from '../config/index.js';
import { estimateOrderRevenue } from './menuCatalog.js';

export const supabase = createClient(supabaseUrl, supabaseKey, { realtime: { enabled: false } });

/** ──────────────────────────────────────────────────────────────
 * REQUESTS CRUD (INSERT)
 */
export async function insertRequest({ hotel_id, from_phone, message, department, priority, room_number, telnyx_id }) {
  const estimated_revenue = estimateOrderRevenue(message);
  const { data, error } = await supabase
    .from('requests')
    .insert([{ hotel_id, from_phone, message, department, priority, room_number, telnyx_id, estimated_revenue }])
    .select();
  if (error) throw new Error(error.message);
  return data[0];
}

/** ──────────────────────────────────────────────────────────────
 * ANALYTICS CORE FUNCTIONS
 */

// 1️⃣ Total Requests
export async function getTotalRequests(startDate, endDate, hotelId) {
  const { count, error } = await supabase
    .from('requests')
    .select('id', { head: true, count: 'exact' })
    .eq('hotel_id', hotelId)
    .gte('created_at', startDate)
    .lte('created_at', endDate);
  if (error) throw new Error(error.message);
  return count;
}

// 2️⃣ SLA Compliance (ack time <= SLA seconds)
export async function getSLACompliance(startDate, endDate, slaSeconds, hotelId) {
  const { data, error } = await supabase
    .from('requests')
    .select('created_at, acknowledged_at')
    .eq('hotel_id', hotelId)
    .gte('created_at', startDate)
    .lte('created_at', endDate);
  if (error) throw new Error(error.message);

  const valid = data.filter(r => r.acknowledged_at && r.created_at);
  if (valid.length === 0) return 0;

  const within = valid.filter(r => {
    const diff = (new Date(r.acknowledged_at) - new Date(r.created_at)) / 1000;
    return diff <= slaSeconds;
  });
  return parseFloat(((within.length / valid.length) * 100).toFixed(2));
}

// 3️⃣ Avg Completion Time
export async function getAvgCompletionTime(startDate, endDate, hotelId) {
  const { data, error } = await supabase
    .from('requests')
    .select('created_at, completed_at')
    .eq('hotel_id', hotelId)
    .gte('created_at', startDate)
    .lte('created_at', endDate);
  if (error) throw new Error(error.message);

  const valid = data.filter(r => r.completed_at && r.created_at);
  if (valid.length === 0) return 0;

  const diffs = valid.map(r => Math.abs(new Date(r.completed_at) - new Date(r.created_at)) / 60000);
  const avg = diffs.reduce((a, b) => a + b, 0) / diffs.length;
  return parseFloat(avg.toFixed(2));
}

// 4️⃣ Escalation Count (> SLA)
export async function getEscalationCount(startDate, endDate, slaSeconds, hotelId) {
  const { data, error } = await supabase
    .from('requests')
    .select('created_at, acknowledged_at')
    .eq('hotel_id', hotelId)
    .gte('created_at', startDate)
    .lte('created_at', endDate);
  if (error) throw new Error(error.message);

  const threshold = slaSeconds * 1000;
  return data.filter(r => {
    const created = new Date(r.created_at).getTime();
    const acked = r.acknowledged_at ? new Date(r.acknowledged_at).getTime() : null;
    if (acked) {
      return (acked - created) > threshold;
    } else {
      const endTime = new Date(endDate).getTime();
      return (endTime - created) > threshold;
    }
  }).length;
}

// 5️⃣ Requests by Department
export async function getRequestsByDepartment(startDate, endDate, hotelId) {
  const { data, error } = await supabase
    .from('requests')
    .select('department')
    .eq('hotel_id', hotelId)
    .gte('created_at', startDate)
    .lte('created_at', endDate);
  if (error) throw new Error(error.message);
  return data.reduce((acc, { department }) => {
    const d = department || 'Unknown';
    acc[d] = (acc[d] || 0) + 1;
    return acc;
  }, {});
}

// 6️⃣ Request Volume Growth
export async function getRequestVolumeGrowth(startDate, endDate, hotelId) {
  const periodCountData = await supabase
    .from('requests')
    .select('id', { head: true, count: 'exact' })
    .eq('hotel_id', hotelId)
    .gte('created_at', startDate)
    .lte('created_at', endDate);
  if (periodCountData.error) throw new Error(periodCountData.error.message);
  const periodCount = periodCountData.count;

  const startDateObj = new Date(startDate);
  const endDateObj = new Date(endDate);
  const msPeriod = endDateObj.getTime() - startDateObj.getTime();
  const prevEnd = new Date(startDateObj.getTime() - 1).toISOString();
  const prevStart = new Date(startDateObj.getTime() - msPeriod - 1).toISOString();

  const prevCountData = await supabase
    .from('requests')
    .select('id', { head: true, count: 'exact' })
    .eq('hotel_id', hotelId)
    .gte('created_at', prevStart)
    .lte('created_at', prevEnd);
  if (prevCountData.error) throw new Error(prevCountData.error.message);
  const prevCount = prevCountData.count;

  const percentChange = prevCount > 0
    ? ((periodCount - prevCount) / prevCount) * 100
    : null;

  return {
    periodCount,
    prevCount,
    percentChange: percentChange !== null ? parseFloat(percentChange.toFixed(2)) : null
  };
}

// 7️⃣ Repeat Guest Activity
export async function getRepeatGuestActivity(startDate, endDate, hotelId) {
  const { data, error } = await supabase
    .from('requests')
    .select('from_phone')
    .eq('hotel_id', hotelId)
    .gte('created_at', startDate)
    .lte('created_at', endDate);
  if (error) throw new Error(error.message);

  const counts = data.reduce((acc, { from_phone }) => {
    acc[from_phone] = (acc[from_phone] || 0) + 1;
    return acc;
  }, {});

  const repeatEntries = Object.entries(counts).filter(([, count]) => count > 1);
  const totalRepeatGuests = repeatEntries.length;
  const totalRepeatRequests = repeatEntries.reduce((sum, [, count]) => sum + count, 0);

  return { totalRepeatGuests, totalRepeatRequests };
}

// 8️⃣ Priority Breakdown
export async function getRequestsByPriority(startDate, endDate, hotelId) {
  const { data, error } = await supabase
    .from('requests')
    .select('priority')
    .eq('hotel_id', hotelId)
    .gte('created_at', startDate)
    .lte('created_at', endDate);
  if (error) throw new Error(error.message);
  return data.reduce((acc, { priority }) => {
    const p = priority || 'Unknown';
    acc[p] = (acc[p] || 0) + 1;
    return acc;
  }, {});
}

// 9️⃣ Estimated Revenue
export async function getEstimatedRevenue(startDate, endDate, hotelId) {
  const { data, error } = await supabase
    .from('requests')
    .select('estimated_revenue')
    .eq('hotel_id', hotelId)
    .gte('created_at', startDate)
    .lte('created_at', endDate);
  if (error) throw new Error(error.message);

  const sum = data.reduce((acc, { estimated_revenue }) => acc + (estimated_revenue || 0), 0);
  return sum;
}

// 🔟 Daily Response Times for Chart
export async function getDailyResponseTimes(startDate, endDate, hotelId) {
  const { data, error } = await supabase
    .from('requests')
    .select('created_at, acknowledged_at')
    .eq('hotel_id', hotelId)
    .gte('created_at', startDate)
    .lte('created_at', endDate);
  if (error) throw new Error(error.message);

  const groups = {};

  data.forEach(r => {
    if (r.acknowledged_at) {
      const dateKey = r.created_at.slice(0, 10);
      const mins = Math.abs(new Date(r.acknowledged_at) - new Date(r.created_at)) / 60000;
      (groups[dateKey] = groups[dateKey] || []).push(mins);
    }
  });

  return Object.entries(groups).map(([date, arr]) => {
    const avgResponseTime = arr.reduce((a, b) => a + b, 0) / arr.length;
    return { date, avgResponseTime: parseFloat(avgResponseTime.toFixed(2)) };
  });
}
