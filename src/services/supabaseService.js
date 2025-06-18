import ws from 'isomorphic-ws';
if (typeof globalThis.WebSocket === 'undefined') {
  globalThis.WebSocket = ws;
}

import { createClient } from '@supabase/supabase-js';
import { supabaseUrl, supabaseKey } from '../config/index.js';
import { estimateOrderRevenue } from './menuCatalog.js';

export const supabase = createClient(supabaseUrl, supabaseKey, { realtime: { enabled: false } });

/** ──────────────────────────────────────────────────────────────
 * REQUESTS CRUD (INSERT + VIP GUEST LOGIC)
 */
export async function insertRequest({ hotel_id, from_phone, message, department, priority, room_number, telnyx_id }) {
  const estimated_revenue = estimateOrderRevenue(message);

  const { data, error } = await supabase
    .from('requests')
    .insert([{ hotel_id, from_phone, message, department, priority, room_number, telnyx_id, estimated_revenue }])
    .select();
  if (error) throw new Error(error.message);
  const request = data[0];

  console.log('📞 Checking guest record for:', from_phone);

  const guestLookup = await supabase
    .from('guests')
    .select('*')
    .eq('phone_number', from_phone)
    .maybeSingle();
  if (guestLookup.error) {
    console.error('❌ Guest lookup error:', guestLookup.error.message);
    throw new Error(guestLookup.error.message);
  }

  let guest = null;
  if (guestLookup.data) {
    console.log('🧑‍🦱 Guest exists. Updating request count...');
    const total = guestLookup.data.total_requests + 1;
    const is_vip = total >= 10;

    const { data: updatedGuest, error: updateErr } = await supabase
      .from('guests')
      .update({ total_requests: total, is_vip, last_seen: new Date() })
      .eq('phone_number', from_phone)
      .select()
      .single();
    if (updateErr) {
      console.error('❌ Guest update failed:', updateErr.message);
      throw new Error(updateErr.message);
    }
    guest = updatedGuest;
    console.log('✅ Guest updated:', guest);
  } else {
    console.log('🆕 Guest not found. Inserting new guest...');
    const { data: newGuest, error: insertErr } = await supabase
      .from('guests')
      .insert({ phone_number: from_phone, total_requests: 1, is_vip: false, last_seen: new Date() })
      .select()
      .single();
    if (insertErr) {
      console.error('❌ Guest insert failed:', insertErr.message);
      throw new Error(insertErr.message);
    }
    guest = newGuest;
    console.log('✅ New guest inserted:', guest);
  }

  return request;
}

/** ──────────────────────────────────────────────────────────────
 * ANALYTICS CORE FUNCTIONS (PHASE 1 + 2)
 */

// ✅ Total Requests
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

// ⚡ Avg Acknowledgement Time (in minutes)
export async function getAvgAckTime(startDate, endDate, hotelId) {
  const { data, error } = await supabase
    .from('requests')
    .select('created_at, acknowledged_at')
    .eq('hotel_id', hotelId)
    .gte('created_at', startDate)
    .lte('created_at', endDate);
  if (error) throw new Error(error.message);
  const times = data
    .filter(r => r.created_at && r.acknowledged_at)
    .map(r => (new Date(r.acknowledged_at) - new Date(r.created_at)) / 60000);
  if (times.length === 0) return 0;
  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  return parseFloat(avg.toFixed(2));
}

// 🚨 Missed SLA Count (> 10 mins)
export async function getMissedSLACount(startDate, endDate, hotelId) {
  const SLA_MS = 10 * 60 * 1000;
  const { data, error } = await supabase
    .from('requests')
    .select('created_at, acknowledged_at')
    .eq('hotel_id', hotelId)
    .gte('created_at', startDate)
    .lte('created_at', endDate);
  if (error) throw new Error(error.message);
  return data.filter(r => {
    if (!r.acknowledged_at) return true;
    return (new Date(r.acknowledged_at) - new Date(r.created_at)) > SLA_MS;
  }).length;
}

// 📈 Requests per Day
export async function getRequestsPerDay(startDate, endDate, hotelId) {
  const { data, error } = await supabase
    .from('requests')
    .select('created_at')
    .eq('hotel_id', hotelId)
    .gte('created_at', startDate)
    .lte('created_at', endDate);
  if (error) throw new Error(error.message);
  const counts = {};
  data.forEach(r => {
    const date = r.created_at.slice(0, 10);
    counts[date] = (counts[date] || 0) + 1;
  });
  return Object.entries(counts).map(([date, count]) => ({ date, count }));
}

// 🧽 Top Departments
export async function getTopDepartments(startDate, endDate, hotelId) {
  const { data, error } = await supabase
    .from('requests')
    .select('department')
    .eq('hotel_id', hotelId)
    .gte('created_at', startDate)
    .lte('created_at', endDate);
  if (error) throw new Error(error.message);
  const tally = {};
  data.forEach(({ department }) => {
    const d = department || 'Unknown';
    tally[d] = (tally[d] || 0) + 1;
  });
  return Object.entries(tally)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([name, value]) => ({ name, value }));
}

// 📞 Most Common Request Words (cleaned)
export async function getCommonRequestWords(startDate, endDate, hotelId) {
  const stopwords = new Set([
    'i','a','the','to','and','is','can','in','of','on','for','me',
    'please','you','get','my','with','need','it','hi','hey','would',
    'like','that','just','do','we','us','send','want','room','at'
  ]);

  const { data, error } = await supabase
    .from('requests')
    .select('message')
    .eq('hotel_id', hotelId)
    .gte('created_at', startDate)
    .lte('created_at', endDate);
  if (error) throw new Error(error.message);

  const wordCounts = {};
  data.forEach(({ message }) => {
    message?.toLowerCase().split(/\W+/).forEach(word => {
      if (word.length >= 3 && !stopwords.has(word) && !/\d/.test(word)) {
        wordCounts[word] = (wordCounts[word] || 0) + 1;
      }
    });
  });

  return Object.entries(wordCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([word, count]) => ({ word, count }));
}

// 🧑‍💼 VIP Guest Count (is_vip = true, scoped by last_seen)
export async function getVIPGuestCount(startDate, endDate) {
  const { count, error } = await supabase
    .from('guests')
    .select('id', { head: true, count: 'exact' })
    .eq('is_vip', true)
    .gte('last_seen', startDate)
    .lte('last_seen', endDate);
  if (error) throw new Error(error.message);
  return count;
}

// 🔁 Repeat Request %
export async function getRepeatRequestRate(startDate, endDate, hotelId) {
  const { data, error } = await supabase
    .from('requests')
    .select('from_phone')
    .eq('hotel_id', hotelId)
    .gte('created_at', startDate)
    .lte('created_at', endDate);
  if (error) throw new Error(error.message);
  const total = data.length;
  const counts = {};
  data.forEach(({ from_phone }) => {
    counts[from_phone] = (counts[from_phone] || 0) + 1;
  });
  const repeat = Object.values(counts).filter(c => c > 1).length;
  return parseFloat(((repeat / (total || 1)) * 100).toFixed(2));
}

// Alias for compatibility
export const getMissedSLAs = getMissedSLACount;

/** ──────────────────────────────────────────────────────────────
 * PHASE 3: ROI METRICS
 */

// 💰 Estimated Revenue
export async function getEstimatedRevenue(startDate, endDate, hotelId) {
  const { data, error } = await supabase
    .from('requests')
    .select('estimated_revenue')
    .eq('hotel_id', hotelId)
    .gte('created_at', startDate)
    .lte('created_at', endDate);
  if (error) throw new Error(error.message);
  return data.reduce((sum, row) => sum + (row.estimated_revenue || 0), 0);
}

// 🕒 Labor Time Saved
export async function getLaborTimeSaved(startDate, endDate, hotelId) {
  const missed = await getMissedSLACount(startDate, endDate, hotelId);
  return missed * 2; // minutes saved
}

// 💯 Service Score Estimate
export async function getServiceScoreEstimate(startDate, endDate, hotelId) {
  const { data, error } = await supabase
    .from('requests')
    .select('created_at, acknowledged_at')
    .eq('hotel_id', hotelId)
    .gte('created_at', startDate)
    .lte('created_at', endDate);
  if (error) throw new Error(error.message);

  const scores = data.map(r => {
    if (!r.acknowledged_at) return 50;
    const deltaSec = (new Date(r.acknowledged_at) - new Date(r.created_at)) / 1000;
    if (deltaSec <= 300) return 100;
    if (deltaSec <= 600) return 90;
    if (deltaSec <= 1200) return 80;
    return 60;
  });

  if (scores.length === 0) return 0;
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
  return parseFloat(avg.toFixed(2));
}

/** ──────────────────────────────────────────────────────────────
 * PHASE 4: ADDITIONAL INSIGHTS
 */

// 1️⃣ Guest Satisfaction Trend
export async function getServiceScoreTrend(startDate, endDate, hotelId) {
  const { data, error } = await supabase
    .from('requests')
    .select('created_at, acknowledged_at')
    .eq('hotel_id', hotelId)
    .gte('created_at', startDate)
    .lte('created_at', endDate);
  if (error) throw new Error(error.message);

  const scoresByWeek = {};
  data.forEach(r => {
    const deltaSec = r.acknowledged_at
      ? (new Date(r.acknowledged_at) - new Date(r.created_at)) / 1000
      : 0;
    const score = deltaSec === 0
      ? 50
      : deltaSec <= 300 ? 100
      : deltaSec <= 600 ? 90
      : deltaSec <= 1200 ? 80
      : 60;

    const d = new Date(r.created_at);
    const year = d.getUTCFullYear();
    const weekNum = Math.ceil(((d - new Date(year, 0, 1)) / 86400000 + new Date(year, 0, 1).getUTCDay() + 1) / 7);
    const week = `${year}-W${String(weekNum).padStart(2,'0')}`;

    (scoresByWeek[week] ||= []).push(score);
  });

  return Object.entries(scoresByWeek)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([period, arr]) => ({
      period,
      avgServiceScore: parseFloat((arr.reduce((x,y) => x + y, 0) / arr.length).toFixed(2))
    }));
}

// 2️⃣ Priority Breakdown
export async function getPriorityBreakdown(startDate, endDate, hotelId) {
  const { data, error } = await supabase
    .from('requests')
    .select('priority')
    .eq('hotel_id', hotelId)
    .gte('created_at', startDate)
    .lte('created_at', endDate);
  if (error) throw new Error(error.message);

  const counts = data.reduce((acc, { priority }) => {
    const p = (priority || 'normal').toLowerCase();
    acc[p] = (acc[p] || 0) + 1;
    return acc;
  }, {});
  return Object.entries(counts).map(([name, value]) => ({ name, value }));
}

// 3️⃣ Average Completion Time
export async function getAvgCompletionTime(startDate, endDate, hotelId) {
  const { data, error } = await supabase
    .from('requests')
    .select('created_at, completed_at')
    .eq('hotel_id', hotelId)
    .gte('created_at', startDate)
    .lte('created_at', endDate);
  if (error) throw new Error(error.message);

  const diffs = data
    .filter(r => r.completed_at)
    .map(r => (new Date(r.completed_at) - new Date(r.created_at)) / 60000);
  if (diffs.length === 0) return 0;
  const avg = diffs.reduce((a,b) => a + b, 0) / diffs.length;
  return parseFloat(avg.toFixed(2));
}

// 4️⃣ Repeat Guest Trend
export async function getRepeatGuestTrend(startDate, endDate, hotelId) {
  const { data, error } = await supabase
    .from('requests')
    .select('from_phone, created_at')
    .eq('hotel_id', hotelId)
    .gte('created_at', startDate)
    .lte('created_at', endDate);
  if (error) throw new Error(error.message);

  const weekTotals = {}, weekRepeat = {}, phoneCounts = {};
  data.forEach(r => {
    const d = new Date(r.created_at);
    const year = d.getUTCFullYear();
    const weekNum = Math.ceil(((d - new Date(year, 0, 1)) / 86400000 + new Date(year, 0, 1).getUTCDay() + 1) / 7);
    const week = `${year}-W${String(weekNum).padStart(2,'0')}`;

    weekTotals[week] = (weekTotals[week] || 0) + 1;
    phoneCounts[r.from_phone] = (phoneCounts[r.from_phone] || 0) + 1;
    if (phoneCounts[r.from_phone] > 1) {
      weekRepeat[week] = (weekRepeat[week] || 0) + 1;
    }
  });

  return Object.entries(weekTotals)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([period, total]) => ({
      period,
      repeatPct: parseFloat(((weekRepeat[period]||0) / total * 100).toFixed(2))
    }));
}

// 5️⃣ Enhanced Labor Time Saved
export async function getEnhancedLaborTimeSaved(startDate, endDate, hotelId) {
  const [missed, avgComplete, totalRequests] = await Promise.all([
    getMissedSLACount(startDate, endDate, hotelId),
    getAvgCompletionTime(startDate, endDate, hotelId),
    getTotalRequests(startDate, endDate, hotelId)
  ]);
  const saved = missed * 5 + totalRequests * avgComplete * 0.1;
  return parseFloat(saved.toFixed(2));
}

// 6️⃣ Requests per Occupied Room *(requires occupancy table)*
export async function getRequestsPerOccupiedRoom(startDate, endDate, hotelId) {
  const { data: occ, error: occErr } = await supabase
    .from('occupancy')
    .select('date, occupied_rooms')
    .eq('hotel_id', hotelId)
    .gte('date', startDate)
    .lte('date', endDate);
  if (occErr) throw new Error(occErr.message);

  const { data: reqs, error: reqErr } = await supabase
    .from('requests')
    .select('created_at')
    .eq('hotel_id', hotelId)
    .gte('created_at', startDate)
    .lte('created_at', endDate);
  if (reqErr) throw new Error(reqErr.message);

  const reqCounts = {};
  reqs.forEach(r => {
    const day = r.created_at.slice(0,10);
    reqCounts[day] = (reqCounts[day]||0) + 1;
  });

  return occ.map(o => ({
    date: o.date,
    requestsPerRoom: o.occupied_rooms > 0
      ? parseFloat(((reqCounts[o.date]||0) / o.occupied_rooms).toFixed(2))
      : 0
  }));
}

// 7️⃣ Top Escalation Reasons *(requires escalation_reason column)*
export async function getTopEscalationReasons(startDate, endDate, hotelId) {
  const { data, error } = await supabase
    .from('requests')
    .select('escalation_reason')
    .eq('hotel_id', hotelId)
    .gte('created_at', startDate)
    .lte('created_at', endDate)
    .not('escalation_reason', 'is', null);
  if (error) throw new Error(error.message);

  const counts = {};
  data.forEach(r => {
    counts[r.escalation_reason] = (counts[r.escalation_reason]||0) + 1;
  });

  return Object.entries(counts)
    .sort((a,b) => b[1] - a[1])
    .slice(0,5)
    .map(([reason, count]) => ({ reason, count }));
}
