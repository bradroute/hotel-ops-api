// src/services/supabaseService.js

import ws from 'isomorphic-ws';
if (typeof globalThis.WebSocket === 'undefined') {
  globalThis.WebSocket = ws;
}

import { createClient } from '@supabase/supabase-js';
import { supabaseUrl, supabaseKey } from '../config/index.js';
import { estimateOrderRevenue } from './menuCatalog.js';

export const supabase = createClient(supabaseUrl, supabaseKey, {
  realtime: { enabled: false }
});
// Sanity check: log the Supabase URL and key prefix to confirm service-role usage
console.log('🚀 Supabase URL:', supabaseUrl);
console.log('🔑 Supabase key prefix:', supabaseKey?.slice(0, 5) + '…');
/** ──────────────────────────────────────────────────────────────
 * REQUESTS CRUD (INSERT + VIP GUEST LOGIC)
 */
export async function insertRequest({ hotel_id, from_phone, message, department, priority, room_number, telnyx_id }) {
  // Estimate revenue
  const estimated_revenue = estimateOrderRevenue(message);

  // Insert the request
  const { data: requestRows, error: insertError } = await supabase
    .from('requests')
    .insert([{ hotel_id, from_phone, message, department, priority, room_number, telnyx_id, estimated_revenue }])
    .select();
  if (insertError) throw new Error(insertError.message);
  const request = requestRows[0];

  console.log('📞 Checking guest record for:', from_phone);

  // Upsert guest (insert if new, update if exists)
  const { data: existingGuest, error: lookupError } = await supabase
    .from('guests')
    .select('total_requests')
    .eq('phone_number', from_phone)
    .maybeSingle();
  if (lookupError) {
    console.error('❌ Guest lookup error:', lookupError.message);
    throw new Error(lookupError.message);
  }

  const total_requests = (existingGuest?.total_requests || 0) + 1;
  const is_vip = total_requests >= 10;

  const { data: guestRows, error: upsertError } = await supabase
    .from('guests')
    .upsert(
      {
        phone_number: from_phone,
        total_requests,
        is_vip,
        last_seen: new Date()
      },
      { onConflict: ['phone_number'], returning: 'representation' }
    )
    .select()
    .single();
  if (upsertError) {
    console.error('❌ Guest upsert failed:', upsertError.message);
    throw new Error(upsertError.message);
  }
  console.log(
    existingGuest ? '✅ Guest updated via upsert:' : '🆕 Guest inserted via upsert:',
    guestRows
  );

  return request;
}

/** ──────────────────────────────────────────────────────────────
 * ANALYTICS CORE FUNCTIONS (PHASE 1 + 2)
 */

// Total number of requests for a hotel in a date range
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

// Average time to acknowledge (minutes)
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
  if (!times.length) return 0;
  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  return parseFloat(avg.toFixed(2));
}

// Missed SLA count (>10 minutes)
export async function getMissedSLACount(startDate, endDate, hotelId) {
  const SLA_MS = 10 * 60 * 1000;
  const { data, error } = await supabase
    .from('requests')
    .select('created_at, acknowledged_at')
    .eq('hotel_id', hotelId)
    .gte('created_at', startDate)
    .lte('created_at', endDate);
  if (error) throw new Error(error.message);
  return data.filter(r => !r.acknowledged_at || (new Date(r.acknowledged_at) - new Date(r.created_at) > SLA_MS)).length;
}

// Requests per day
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
    const day = r.created_at.slice(0, 10);
    counts[day] = (counts[day] || 0) + 1;
  });
  return Object.entries(counts).map(([date, count]) => ({ date, count }));
}

// Top 3 departments by request count
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

// Most common words in requests
export async function getCommonRequestWords(startDate, endDate, hotelId) {
  const stopwords = new Set([
    'i','a','the','to','and','is','can','in','of','on','for','me',
    'please','you','get','my','with','need','it','hi','hey','would',
    'like','that','just','do','we','us','send','want','room','at','but',
    'your','this','so','as','if','are','be','by','from','or','not',
    'no','yes','ok','okay','thanks','thank','hello','good',
    'morning','afternoon','evening','night','call','text','right','now',
    'some'
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

// VIP guest count
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

// Repeat request rate
export async function getRepeatRequestRate(startDate, endDate, hotelId) {
  const { data, error } = await supabase
    .from('requests')
    .select('from_phone')
    .eq('hotel_id', hotelId)
    .gte('created_at', startDate)
    .lte('created_at', endDate);
  if (error) throw new Error(error.message);
  const guestCounts = {};
  data.forEach(({ from_phone }) => {
    guestCounts[from_phone] = (guestCounts[from_phone] || 0) + 1;
  });
  const totalGuests = Object.keys(guestCounts).length;
  const repeatGuests = Object.values(guestCounts).filter(c => c > 1).length;
  return parseFloat(((repeatGuests / (totalGuests || 1)) * 100).toFixed(2));
}

// Alias
export const getMissedSLAs = getMissedSLACount;

/** ──────────────────────────────────────────────────────────────
 * PHASE 3: ROI METRICS
 */

// Estimated revenue
export async function getEstimatedRevenue(startDate, endDate, hotelId) {
  const { data, error } = await supabase
    .from('requests')
    .select('estimated_revenue')
    .eq('hotel_id', hotelId)
    .gte('created_at', startDate)
    .lte('created_at', endDate);
  if (error) throw new Error(error.message);
  return data.reduce((sum, r) => sum + (r.estimated_revenue || 0), 0);
}

// Labor time saved estimation
export async function getLaborTimeSaved(startDate, endDate, hotelId) {
  const missed = await getMissedSLACount(startDate, endDate, hotelId);
  return missed * 2; // minutes
}

// Service score estimate
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
    const secs = (new Date(r.acknowledged_at) - new Date(r.created_at)) / 1000;
    if (secs <= 300) return 100;
    if (secs <= 600) return 90;
    if (secs <= 1200) return 80;
    return 60;
  });
  return scores.length ? parseFloat((scores.reduce((a,b)=>a+b)/scores.length).toFixed(2)) : 0;
}

/** ──────────────────────────────────────────────────────────────
 * PHASE 4: ADDITIONAL INSIGHTS
 */

// Service score trend per week
export async function getServiceScoreTrend(startDate, endDate, hotelId) {
  const { data, error } = await supabase
    .from('requests')
    .select('created_at, acknowledged_at')
    .eq('hotel_id', hotelId)
    .gte('created_at', startDate)
    .lte('created_at', endDate);
  if (error) throw new Error(error.message);

  const byWeek = {};
  data.forEach(r => {
    const d = new Date(r.created_at);
    const year = d.getUTCFullYear();
    const weekNum = Math.ceil(((d - new Date(year,0,1))/86400000 + new Date(year,0,1).getUTCDay()+1)/7);
    const week = `${year}-W${String(weekNum).padStart(2,'0')}`;
    const score = r.acknowledged_at ? (
      (new Date(r.acknowledged_at)-new Date(r.created_at))/1000 <= 300 ? 100 :
      (new Date(r.acknowledged_at)-new Date(r.created_at))/1000 <= 600 ? 90 :
      (new Date(r.acknowledged_at)-new Date(r.created_at))/1000 <= 1200 ? 80 : 60
    ) : 50;
    (byWeek[week] ||= []).push(score);
  });
  return Object.entries(byWeek).sort().map(([period, arr]) => ({ period, avgServiceScore: parseFloat((arr.reduce((a,b)=>a+b)/arr.length).toFixed(2)) }));
}

// Priority breakdown
export async function getPriorityBreakdown(startDate, endDate, hotelId) {
  const { data, error } = await supabase
    .from('requests')
    .select('priority')
    .eq('hotel_id', hotelId)
    .gte('created_at', startDate)
    .lte('created_at', endDate);
  if (error) throw new Error(error.message);
  const counts = data.reduce((acc, { priority }) => {
    const p = (priority||'normal').toLowerCase(); acc[p]=(acc[p]||0)+1; return acc;
  }, {});
  return Object.entries(counts).map(([name,value])=>({ name,value }));
}

// Average completion time
export async function getAvgCompletionTime(startDate, endDate, hotelId) {
  const { data, error } = await supabase
    .from('requests')
    .select('created_at, completed_at')
    .eq('hotel_id', hotelId)
    .gte('created_at', startDate)
    .lte('created_at', endDate);
  if (error) throw new Error(error.message);
  const diffs = data.filter(r=>r.completed_at).map(r=>(new Date(r.completed_at)-new Date(r.created_at))/60000);
  return diffs.length?parseFloat((diffs.reduce((a,b)=>a+b)/diffs.length).toFixed(2)):0;
}

// Repeat guest trend
export async function getRepeatGuestTrend(startDate, endDate, hotelId) {
  const { data, error } = await supabase
    .from('requests')
    .select('from_phone, created_at')
    .eq('hotel_id', hotelId)
    .gte('created_at', startDate)
    .lte('created_at', endDate);
  if (error) throw new Error(error.message);
  const weekTotals={}, weekRepeat={}, phoneCounts={};
  data.forEach(r=>{
    const d = new Date(r.created_at); const year=d.getUTCFullYear(); const weekNum=Math.ceil(((d-new Date(year,0,1))/86400000+new Date(year,0,1).getUTCDay()+1)/7); const week=`${year}-W${String(weekNum).padStart(2,'0')}`;
    weekTotals[week]=(weekTotals[week]||0)+1; phoneCounts[r.from_phone]=(phoneCounts[r.from_phone]||0)+1;
    if(phoneCounts[r.from_phone]>1) weekRepeat[week]=(weekRepeat[week]||0)+1;
  });
  return Object.entries(weekTotals).sort().map(([period,total])=>({ period, repeatPct: parseFloat(((weekRepeat[period]||0)/total*100).toFixed(2)) }));
}

// Enhanced labor time saved
export async function getEnhancedLaborTimeSaved(startDate, endDate, hotelId) {
  const [missed, avgComp, total] = await Promise.all([
    getMissedSLACount(startDate,endDate,hotelId),
    getAvgCompletionTime(startDate,endDate,hotelId),
    getTotalRequests(startDate,endDate,hotelId)
  ]);
  return parseFloat((missed*5 + total*avgComp*0.1).toFixed(2));
}

// Requests per occupied room (requires occupancy table)
export async function getRequestsPerOccupiedRoom(startDate, endDate, hotelId) {
  const { data:occ, error:occErr } = await supabase.from('occupancy').select('date, occupied_rooms').eq('hotel_id',hotelId).gte('date',startDate).lte('date',endDate);
  if(occErr) throw new Error(occErr.message);
  const { data:reqs, error:reqErr } = await supabase.from('requests').select('created_at').eq('hotel_id',hotelId).gte('created_at',startDate).lte('created_at',endDate);
  if(reqErr) throw new Error(reqErr.message);
  const counts = {};
  reqs.forEach(r=>{ const day=r.created_at.slice(0,10); counts[day]=(counts[day]||0)+1; });
  return occ.map(o=>({ date:o.date, requestsPerRoom: o.occupied_rooms? parseFloat(((counts[o.date]||0)/o.occupied_rooms).toFixed(2)):0 }));
}

// Top escalation reasons
export async function getTopEscalationReasons(startDate, endDate, hotelId) {
  const { data, error } = await supabase.from('requests').select('escalation_reason').eq('hotel_id',hotelId).gte('created_at',startDate).lte('created_at',endDate).not('escalation_reason','is',null);
  if(error) throw new Error(error.message);
  const counts={}; data.forEach(r=>{counts[r.escalation_reason]=(counts[r.escalation_reason]||0)+1;});
  return Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([reason,count])=>({ reason,count }));
}

// Daily completion rate
export async function getDailyCompletionRate(startDate, endDate, hotelId) {
  const { data, error } = await supabase.from('requests').select('created_at, completed_at').eq('hotel_id',hotelId).gte('created_at',startDate).lte('created_at',endDate);
  if(error) throw new Error(error.message);
  const byDate={}; data.forEach(({created_at,completed_at})=>{const day=created_at.slice(0,10); byDate[day]=byDate[day]||{total:0,completed:0}; byDate[day].total++; if(completed_at) byDate[day].completed++;});
  return Object.entries(byDate).map(([date,{total,completed}])=>({ date, completionRate: parseFloat(((completed/total)*100).toFixed(2)) }));
}

// Weekly completion rate
export async function getWeeklyCompletionRate(startDate, endDate, hotelId) {
  const { data, error } = await supabase.from('requests').select('created_at, completed_at').eq('hotel_id',hotelId).gte('created_at',startDate).lte('created_at',endDate);
  if(error) throw new Error(error.message);
  const byWeek={}; data.forEach(({created_at,completed_at})=>{const d=new Date(created_at); const year=d.getUTCFullYear(); const weekNum=Math.ceil(((d-new Date(year,0,1))/86400000+new Date(year,0,1).getUTCDay()+1)/7); const week=`${year}-W${String(weekNum).padStart(2,'0')}`; byWeek[week]=byWeek[week]||{total:0,completed:0}; byWeek[week].total++; if(completed_at) byWeek[week].completed++;});
  return Object.entries(byWeek).sort().map(([period,{total,completed}])=>({ period, completionRate: parseFloat(((completed/total)*100).toFixed(2)) }));
}

// Monthly completion rate
export async function getMonthlyCompletionRate(startDate, endDate, hotelId) {
  const { data, error } = await supabase.from('requests').select('created_at, completed_at').eq('hotel_id',hotelId).gte('created_at',startDate).lte('created_at',endDate);
  if(error) throw new Error(error.message);
  const byMonth={}; data.forEach(({created_at,completed_at})=>{const month=created_at.slice(0,7); byMonth[month]=byMonth[month]||{total:0,completed:0}; byMonth[month].total++; if(completed_at) byMonth[month].completed++;});
  return Object.entries(byMonth).sort().map(([period,{total,completed}])=>({ period, completionRate: parseFloat(((completed/total)*100).toFixed(2)) }));
}
