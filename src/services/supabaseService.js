import dotenv from 'dotenv';
dotenv.config();

import ws from 'isomorphic-ws';
if (typeof globalThis.WebSocket === 'undefined') {
  globalThis.WebSocket = ws;
}

import { createClient } from '@supabase/supabase-js';
import { supabaseUrl, supabaseKey, supabaseServiceRoleKey } from '../config/index.js';
import { estimateOrderRevenue } from './menuCatalog.js';
import { enrichRequest } from './classifier.js'; // <-- AI enrichment import

export const supabase = createClient(supabaseUrl, supabaseKey, {
  realtime: { enabled: false }
});

export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey, {
  realtime: { enabled: false }
});

/** ──────────────────────────────────────────────────────────────
 * REQUESTS CRUD
 */
export async function insertRequest({
  hotel_id,
  from_phone,
  message,
  department,
  priority,
  room_number,
  telnyx_id,
  is_staff,
  is_vip,
  // ✅ persist the request source (defaults to app_guest so DB doesn't fall back to 'sms')
  source = 'app_guest',
  // optional enrichment passthroughs (kept if you want to override)
  summary,
  root_cause,
  sentiment,
  needs_attention,
}) {
  const estimated_revenue = estimateOrderRevenue(message);

  // --- AI ENRICHMENT STEP ---
  let enrichment = {};
  try {
    enrichment = await enrichRequest(message);
    console.log('🧠 AI enrichment:', enrichment);
  } catch (err) {
    console.error('❌ AI enrichment failed:', err);
  }

  // Ensure guest exists or update last_seen (only when we have a phone)
  if (from_phone) {
    const { data: existingGuest } = await supabase
      .from('guests')
      .select('id')
      .eq('phone_number', from_phone)
      .eq('hotel_id', hotel_id)
      .maybeSingle();

    if (!existingGuest) {
      await supabase.from('guests').insert({
        phone_number: from_phone,
        is_vip: !!is_vip,
        hotel_id,
        last_seen: new Date().toISOString()
      });
    } else {
      await supabase
        .from('guests')
        .update({ last_seen: new Date().toISOString() })
        .eq('id', existingGuest.id);
    }
  } else {
    console.warn('[insertRequest] from_phone is empty; skipping guest upsert');
  }

  // Ensure staff number is in authorized_numbers (only when flagged *and* phone present)
  if (is_staff && from_phone) {
    const { data: existingStaff } = await supabase
      .from('authorized_numbers')
      .select('id')
      .eq('phone', from_phone)
      .eq('hotel_id', hotel_id)
      .maybeSingle();

    if (!existingStaff) {
      await supabase.from('authorized_numbers').insert({
        phone: from_phone,
        is_staff: true,
        hotel_id
      });
    }
  }

  // Build the payload for the new request
  const payload = {
    hotel_id,
    from_phone: from_phone || null,
    message,
    department,
    // keep caller-provided priority unless enrichment suggests one
    priority: enrichment.priority || priority || 'normal',
    room_number,
    telnyx_id: telnyx_id ?? null,
    estimated_revenue,
    is_staff: !!is_staff,
    is_vip: !!is_vip,
    // ✅ ensure 'source' is stored (enum: 'sms' | 'app_guest' | 'app_staff')
    source: source || 'app_guest',
    // AI enrichment (caller-provided fields win if passed)
    summary: summary ?? enrichment.summary ?? null,
    root_cause: root_cause ?? enrichment.root_cause ?? null,
    sentiment: sentiment ?? enrichment.sentiment ?? null,
    needs_attention:
      typeof needs_attention === 'boolean'
        ? needs_attention
        : (enrichment.needs_attention ?? false),
  };
  console.log('🔽 insertRequest payload:', payload);

  // Insert into requests table
  const { data, error } = await supabase
    .from('requests')
    .insert([payload])
    .select('*')
    .single(); // return a single row

  if (error) {
    console.error('❌ Supabase “requests” INSERT error:', error);
    throw new Error(error.message);
  }
  console.log('✅ Supabase “requests” INSERT succeeded:', data);

  return data;
}

/** ──────────────────────────────────────────────────────────────
 * ANALYTICS CORE FUNCTIONS (PHASE 1 + 2)
 */
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
  return parseFloat((times.reduce((a,b) => a + b, 0) / times.length).toFixed(2));
}

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
    const day = r.created_at.slice(0,10);
    counts[day] = (counts[day] || 0) + 1;
  });
  return Object.entries(counts).map(([date, count]) => ({ date, count }));
}

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
    .sort((a,b) => b[1] - a[1])
    .slice(0,3)
    .map(([name, value]) => ({ name, value }));
}

export async function getCommonRequestWords(startDate, endDate, hotelId) {
  const stopwords = new Set([
    'i','me','my','you','your','we','us','our','they','them','he','she','it','their',
    'hi','hey','hello','good','morning','afternoon','evening','night','thanks','thank','please','ok','okay',
    'need','want','would','like','get','send','bring','have','do','can','could','is','are','be','was','were','am','has','had','will','may','might','must','should','shall',
    'a','an','the','to','in','on','for','from','of','at','as','by','with','about','into','onto','over','under','out','up','down','off','through','around','between',
    'and','or','but','if','so','not','no','yes','that','this','there','which','what','when','who','whom','where','why','how',
    'right','now','some','any','all','just','too','more','less','still','again','another','same',
    'today','tonight','tomorrow','soon','later','before','after',
    'call','text','message','reply',
    'room','suite','number','door',
    'something','thing','stuff','items'
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
    message.toLowerCase().split(/\W+/).forEach(word => {
      if (word.length >= 3 && !stopwords.has(word) && !/\d/.test(word)) {
        wordCounts[word] = (wordCounts[word] || 0) + 1;
      }
    });
  });
  return Object.entries(wordCounts)
    .sort((a,b) => b[1] - a[1])
    .slice(0,5)
    .map(([word, count]) => ({ word, count }));
}

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

export async function getRepeatRequestRate(startDate, endDate, hotelId) {
  const { data, error } = await supabase
    .from('requests')
    .select('from_phone')
    .eq('hotel_id', hotelId)
    .gte('created_at', startDate)
    .lte('created_at', endDate);
  if (error) throw new Error(error.message);
  const counts = {};
  data.forEach(({ from_phone }) => {
    counts[from_phone] = (counts[from_phone] || 0) + 1;
  });
  const totalGuests = Object.keys(counts).length;
  const repeatGuests = Object.values(counts).filter(c => c > 1).length;
  return parseFloat(((repeatGuests / (totalGuests || 1)) * 100).toFixed(2));
}

export const getMissedSLAs = getMissedSLACount;

export async function getEstimatedRevenue(startDate, endDate, hotelId) {
  const { data, error } = await supabase
    .from('requests')
    .select('estimated_revenue')
    .eq('hotel_id', hotelId)
    .gte('created_at', startDate)
    .lte('created_at', endDate);
  if (error) throw new Error(error.message);
  return data.reduce((sum,r) => sum + (r.estimated_revenue || 0), 0);
}

// ------------- UPDATED LABOR TIME SAVED ANALYTICS BELOW -------------

export async function getLaborTimeSaved(startDate, endDate, hotelId) {
  const total = await getTotalRequests(startDate, endDate, hotelId);
  const MINUTES_SAVED_PER_REQUEST = 4;
  return total * MINUTES_SAVED_PER_REQUEST;
}

export const getEnhancedLaborTimeSaved = getLaborTimeSaved;

// --------------------------------------------------------------------

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
  return scores.length ? parseFloat((scores.reduce((a,b) => a + b) / scores.length).toFixed(2)) : 0;
}

export async function getServiceScoreTrend(startDate,endDate,hotelId) {
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
    const weekNum = Math.ceil(((d - new Date(year,0,1)) / 86400000 + new Date(year,0,1).getUTCDay()+1) / 7);
    const week = `${year}-W${String(weekNum).padStart(2,'0')}`;
    const score = r.acknowledged_at
      ? ((new Date(r.acknowledged_at) - new Date(r.created_at)) / 1000 <= 300
         ? 100
         : ((new Date(r.acknowledged_at) - new Date(r.created_at)) / 1000 <= 600
            ? 90
            : ((new Date(r.acknowledged_at) - new Date(r.created_at)) / 1000 <= 1200
               ? 80
               : 60)))
      : 50;
    if (!byWeek[week]) byWeek[week] = [];
    byWeek[week].push(score);
  });
  return Object.entries(byWeek)
    .sort()
    .map(([period, arr]) => ({ period, avgServiceScore: parseFloat((arr.reduce((a,b) => a+b)/arr.length).toFixed(2)) }));
}

export async function getPriorityBreakdown(startDate,endDate,hotelId) {
  const { data, error } = await supabase
    .from('requests')
    .select('priority')
    .eq('hotel_id', hotelId)
    .gte('created_at', startDate)
    .lte('created_at', endDate);
  if (error) throw new Error(error.message);
  const counts = data.reduce((acc,{priority}) => { const p = (priority||'normal').toLowerCase(); acc[p] = (acc[p]||0)+1; return acc; }, {});
  return Object.entries(counts).map(([name,value]) => ({ name,value }));
}

export async function getAvgCompletionTime(startDate,endDate,hotelId) {
  const { data, error } = await supabase
    .from('requests')
    .select('created_at,completed_at')
    .eq('hotel_id', hotelId)
    .gte('created_at', startDate)
    .lte('created_at', endDate);
  if (error) throw new Error(error.message);
  const diffs = data.filter(r => r.completed_at).map(r => (new Date(r.completed_at) - new Date(r.created_at)) / 60000);
  return diffs.length ? parseFloat((diffs.reduce((a,b) => a+b)/diffs.length).toFixed(2)) : 0;
}

export async function getRepeatGuestTrend(startDate,endDate,hotelId) {
  const { data, error } = await supabase
    .from('requests')
    .select('from_phone,created_at')
    .eq('hotel_id', hotelId)
    .gte('created_at', startDate)
    .lte('created_at', endDate);
  if (error) throw new Error(error.message);
  const totals = {};
  const repeat = {};
  const counts = {};
  data.forEach(r => {
    const d = new Date(r.created_at);
    const year = d.getUTCFullYear();
    const weekNum = Math.ceil(((d - new Date(year,0,1)) / 86400000 + new Date(year,0,1).getUTCDay()+1) / 7);
    const week = `${year}-W${String(weekNum).padStart(2,'0')}`;
    totals[week] = (totals[week]||0)+1;
    counts[r.from_phone] = (counts[r.from_phone]||0)+1;
    if (counts[r.from_phone] > 1) repeat[week] = (repeat[week]||0)+1;
  });
  return Object.entries(totals)
    .sort()
    .map(([period,total]) => ({ period, repeatPct: parseFloat(((repeat[period]||0)/total*100).toFixed(2)) }));
}

export async function getRequestsPerOccupiedRoom(startDate,endDate,hotelId) {
  const { data: occ, error: occErr } = await supabase
    .from('occupancy')
    .select('date,occupied_rooms')
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
  const countsPer = {};
  reqs.forEach(r => {
    const d = r.created_at.slice(0,10);
    countsPer[d] = (countsPer[d]||0)+1;
  });
  return occ.map(o => ({ date: o.date, requestsPerRoom: o.occupied_rooms ? parseFloat(((countsPer[o.date]||0)/o.occupied_rooms).toFixed(2)) : 0 }));
}

export async function getTopEscalationReasons(startDate,endDate,hotelId) {
  const { data, error } = await supabase
    .from('requests')
    .select('escalation_reason')
    .eq('hotel_id', hotelId)
    .gte('created_at', startDate)
    .lte('created_at', endDate)
    .not('escalation_reason','is',null);
  if (error) throw new Error(error.message);
  const reasons = {};
  data.forEach(r => { reasons[r.escalation_reason] = (reasons[r.escalation_reason]||0)+1; });
  return Object.entries(reasons)
    .sort((a,b) => b[1] - a[1])
    .slice(0,5)
    .map(([reason,count]) => ({ reason,count }));
}

export async function getDailyCompletionRate(startDate,endDate,hotelId) {
  const { data, error } = await supabase
    .from('requests')
    .select('created_at,completed_at')
    .eq('hotel_id', hotelId)
    .gte('created_at', startDate)
    .lte('created_at', endDate);
  if (error) throw new Error(error.message);
  const byDay = {};
  data.forEach(({created_at,completed_at}) => {
    const day = created_at.slice(0,10);
    if (!byDay[day]) byDay[day] = { total:0, completed:0 };
    byDay[day].total++;
    if (completed_at) byDay[day].completed++;
  });
  return Object.entries(byDay)
    .map(([date,{total,completed}]) => ({ date, completionRate: parseFloat(((completed/total)*100).toFixed(2)) }));
}

export async function getWeeklyCompletionRate(startDate,endDate,hotelId) {
  const { data, error } = await supabase
    .from('requests')
    .select('created_at,completed_at')
    .eq('hotel_id', hotelId)
    .gte('created_at', startDate)
    .lte('created_at', endDate);
  if (error) throw new Error(error.message);
  const byWeek = {};
  data.forEach(({created_at,completed_at}) => {
    const d = new Date(created_at);
    const year = d.getUTCFullYear();
    const weekNum = Math.ceil(((d - new Date(year,0,1)) / 86400000 + new Date(year,0,1).getUTCDay()+1) / 7);
    const week = `${year}-W${String(weekNum).padStart(2,'0')}`;
    if (!byWeek[week]) byWeek[week] = { total:0, completed:0 };
    byWeek[week].total++;
    if (completed_at) byWeek[week].completed++;
  });
  return Object.entries(byWeek)
    .sort()
    .map(([period,{total,completed}]) => ({ period, completionRate: parseFloat(((completed/total)*100).toFixed(2)) }));
}

export async function getMonthlyCompletionRate(startDate,endDate,hotelId) {
  const { data, error } = await supabase
    .from('requests')
    .select('created_at,completed_at')
    .eq('hotel_id', hotelId)
    .gte('created_at', startDate)
    .lte('created_at', endDate);
  if (error) throw new Error(error.message);
  const byMonth = {};
  data.forEach(({created_at,completed_at}) => {
    const month = created_at.slice(0,7);
    if (!byMonth[month]) byMonth[month] = { total:0, completed:0 };
    byMonth[month].total++;
    if (completed_at) byMonth[month].completed++;
  });
  return Object.entries(byMonth)
    .sort()
    .map(([period,{total,completed}]) => ({ period, completionRate: parseFloat(((completed/total)*100).toFixed(2)) }));
}

/** ──────────────────────────────────────────────────────────────
 * DEPARTMENT SETTINGS
 */
export async function getEnabledDepartments(hotelId) {
  const { data, error } = await supabase
    .from('department_settings')
    .select('department, enabled')
    .eq('hotel_id', hotelId);

  if (error) throw new Error(`getEnabledDepartments: ${error.message}`);

  const enabled = data
    .filter(row =>
      row.enabled === true ||
      row.enabled === 'true' ||
      row.enabled === 'TRUE' ||
      row.enabled === 1 ||
      row.enabled === '1'
    )
    .map(row => row.department);

  return enabled;
}

export async function updateDepartmentToggle(hotelId, department, enabled) {
  const { error } = await supabase
    .from('department_settings')
    .upsert({ hotel_id: hotelId, department, enabled }, { onConflict: ['hotel_id','department'] });
  if (error) throw new Error(`updateDepartmentToggle: ${error.message}`);
}

export async function getAllDepartmentSettings(hotelId) {
  const { data, error } = await supabase
    .from('department_settings')
    .select('department, enabled')
    .eq('hotel_id', hotelId);
  if (error) throw new Error(`getAllDepartmentSettings: ${error.message}`);
  return data;
}

export async function getHotelProfile(hotelId) {
  const { data, error } = await supabase
    .from('hotels')
    .select('*')
    .eq('id', hotelId)
    .single();
  return { data, error };
}

export async function updateHotelProfile(hotelId, updates) {
  const { error } = await supabase
    .from('hotels')
    .update(updates)
    .eq('id', hotelId);
  return error;
}

export async function getSlaSettings(hotelId) {
  const { data, error } = await supabase
    .from('sla_settings')
    .select('department, ack_time_minutes, res_time_minutes, is_active')
    .eq('hotel_id', hotelId);
  return { data, error };
}

export async function upsertSlaSettings(hotelId, slaMap) {
  const payload = Object.entries(slaMap).map(([department, { ack_time, res_time, is_active }]) => ({
    hotel_id: hotelId,
    department,
    ack_time_minutes: ack_time,
    res_time_minutes: res_time,
    is_active,
  }));
  const { data, error } = await supabase
    .from('sla_settings')
    .upsert(payload, { onConflict: ['hotel_id', 'department'] });
  return { data, error };
}
