// src/services/supabaseService.js
// Final — guarded AI calls, SMS/app source defaults, dup-safe insert, spaces support

import dotenv from 'dotenv';
dotenv.config();

import ws from 'isomorphic-ws';
if (typeof globalThis.WebSocket === 'undefined') {
  // @ts-ignore
  globalThis.WebSocket = ws;
}

import { createClient } from '@supabase/supabase-js';
import { supabaseUrl, supabaseKey, supabaseServiceRoleKey } from '../config/index.js';
import { estimateOrderRevenue } from './menuCatalog.js';
import { enrichRequest, classify } from './classifier.js'; // AI enrichment + classification

export const supabase = createClient(supabaseUrl, supabaseKey, {
  realtime: { enabled: false },
});

export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey, {
  realtime: { enabled: false },
});

/* ──────────────────────────────────────────────────────────────
 * helpers
 */
const toE164 = (v) => {
  if (!v) return null;
  const d = String(v).replace(/\D/g, '');
  if (!d) return null;
  return d.startsWith('1') ? `+${d}` : `+1${d}`;
};

// shift a UTC ISO string into a local Date object using a numeric tz offset (minutes)
const shiftToLocal = (iso, tzOffsetMinutes = -300) => {
  const utcMs = new Date(iso).getTime();
  return new Date(utcMs + tzOffsetMinutes * 60 * 1000);
};

/** Resolve hotel_id by guest_code (a.k.a. property code) */
export async function getHotelIdByCode(propertyCode) {
  const code = String(propertyCode || '').trim();
  if (!code) return null;
  const { data, error } = await supabase
    .from('hotels')
    .select('id')
    .eq('guest_code', code)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data?.id ?? null;
}

/* ──────────────────────────────────────────────────────────────
 * SPACES (conference rooms, lounge, outlets, etc.)
 */
export async function getHotelSpaces(hotelId, { activeOnly = true } = {}) {
  if (!hotelId) return [];
  let q = supabase
    .from('hotel_spaces')
    .select('id, name, category, is_active')
    .eq('hotel_id', hotelId);
  if (activeOnly) q = q.eq('is_active', true);
  const { data, error } = await q.order('name', { ascending: true });
  if (error) throw new Error(error.message);
  return data || [];
}

export async function getHotelSpacesByCode(propertyCode, { activeOnly = true } = {}) {
  const hotelId = await getHotelIdByCode(propertyCode);
  if (!hotelId) return [];
  return getHotelSpaces(hotelId, { activeOnly });
}

export async function getSpaceById(spaceId) {
  if (!spaceId) return null;
  const { data, error } = await supabase
    .from('hotel_spaces')
    .select('id, hotel_id, name, category, is_active')
    .eq('id', spaceId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ?? null;
}

/** Internal: ensure space_id belongs to hotel_id; otherwise null */
async function validateSpaceIdForHotel(space_id, hotel_id) {
  if (!space_id || !hotel_id) return null;
  const { data, error } = await supabase
    .from('hotel_spaces')
    .select('id')
    .eq('id', space_id)
    .eq('hotel_id', hotel_id)
    .maybeSingle();
  if (error) {
    console.warn('validateSpaceIdForHotel error:', error.message);
    return null;
  }
  return data?.id ?? null;
}

/* ──────────────────────────────────────────────────────────────
 * REQUESTS CRUD
 *  - AI decides department & priority when caller doesn’t provide them
 *  - enrichRequest() only fills missing summary/root_cause/sentiment/needs_attention
 *  - persists source, app_account_id, from_phone
 *  - optional space_id
 */
export async function insertRequest({
  hotel_id,
  from_phone,
  message,
  department,      // optional (AI fills if missing)
  priority,        // optional (AI fills if missing)
  room_number,
  space_id,
  telnyx_id,
  is_staff,
  is_vip,
  source = undefined, // resolved below; defaults to 'sms' when telnyx_id present
  summary,
  root_cause,
  sentiment,
  needs_attention,
  app_account_id,
  lat,
  lng,
}) {
  const estimated_revenue = estimateOrderRevenue(message);

  // ---- AI classification (only if missing) ----
  let aiDept = null, aiPrio = null, aiRoom = null;
  const needDept = !department;
  const needPrio = !priority;
  const needRoom = !room_number;
  if (needDept || needPrio || needRoom) {
    try {
      const cls = await classify(message, hotel_id);
      aiDept = needDept ? (cls?.department || null) : null;
      aiPrio = needPrio ? (cls?.priority || null)   : null;
      aiRoom = needRoom ? (cls?.room_number || null): null;
    } catch (err) {
      console.error('❌ classify() failed:', err);
    }
  }

  // ---- AI enrichment (only if any enrichment value missing) ----
  let enrichment = {};
  const needEnrich =
    summary == null || root_cause == null || sentiment == null || needs_attention == null;
  if (needEnrich) {
    try {
      enrichment = await enrichRequest(message);
    } catch (err) {
      console.error('❌ enrichRequest() failed:', err);
    }
  }

  // Normalize phone
  const phoneNorm = toE164(from_phone);

  // Ensure guest exists or update last_seen
  if (phoneNorm) {
    const { data: existingGuest } = await supabase
      .from('guests')
      .select('id')
      .eq('phone_number', phoneNorm)
      .eq('hotel_id', hotel_id)
      .maybeSingle();

    if (!existingGuest) {
      await supabase.from('guests').insert({
        phone_number: phoneNorm,
        is_vip: !!is_vip,
        hotel_id,
        last_seen: new Date().toISOString(),
      });
    } else {
      await supabase
        .from('guests')
        .update({ last_seen: new Date().toISOString() })
        .eq('id', existingGuest.id);
    }
  }

  // Ensure staff number is tracked if applicable
  if (is_staff && phoneNorm) {
    const { data: existingStaff } = await supabase
      .from('authorized_numbers')
      .select('id')
      .eq('phone', phoneNorm)
      .eq('hotel_id', hotel_id)
      .maybeSingle();

    if (!existingStaff) {
      await supabase.from('authorized_numbers').insert({
        phone: phoneNorm,
        is_staff: true,
        hotel_id,
      });
    }
  }

  // Validate space_id (must belong to same hotel)
  const finalSpaceId = await validateSpaceIdForHotel(space_id, hotel_id);

  // Final values (prefer provided → AI → defaults)
  const finalDepartment = department || aiDept || 'Front Desk';
  const finalPriority   = (priority || aiPrio || 'normal').toLowerCase();

  // Room number normalization
  const normalizeRoom = (v) =>
    typeof v === 'string' ? v.trim() : (v == null ? '' : String(v));
  const providedRoom = normalizeRoom(room_number);
  const aiRoomNorm   = normalizeRoom(aiRoom);
  const finalRoom    = providedRoom !== '' ? providedRoom : aiRoomNorm; // may be ''

  // Build payload and insert
  const payload = {
    hotel_id,
    from_phone: phoneNorm,
    message,
    department: finalDepartment,
    priority: finalPriority,      // normalized lowercase
    room_number: finalRoom,
    space_id: finalSpaceId ?? null,
    telnyx_id: telnyx_id ?? null,
    estimated_revenue,
    is_staff: !!is_staff,
    is_vip: !!is_vip,
    // default source: if telnyx_id present → 'sms', else provided or 'app_guest'
    source: source || (telnyx_id ? 'sms' : 'app_guest'),
    app_account_id: app_account_id ?? null,
    // AI enrichment with caller override
    summary:        summary        ?? enrichment.summary        ?? null,
    root_cause:     root_cause     ?? enrichment.root_cause     ?? null,
    sentiment:      sentiment      ?? enrichment.sentiment      ?? null,
    needs_attention:
      typeof needs_attention === 'boolean'
        ? needs_attention
        : (enrichment.needs_attention ?? false),
    // optional context
    lat: typeof lat === 'number' ? lat : null,
    lng: typeof lng === 'number' ? lng : null,
  };

  try {
    const { data, error } = await supabase
      .from('requests')
      .insert([payload])
      .select('*')
      .single();

    if (error) throw error;
    return data;
  } catch (e) {
    // absorb duplicate on unique index (requests.telnyx_id IS NOT NULL)
    const msg = String(e?.message || '');
    if (String(e?.code) === '23505' || /duplicate key value/i.test(msg)) {
      if (telnyx_id) {
        const { data: existing, error: selErr } = await supabase
          .from('requests')
          .select('*')
          .eq('telnyx_id', telnyx_id)
          .maybeSingle();
        if (!selErr && existing) return existing;
      }
    }
    console.error('❌ Supabase “requests” INSERT error:', e);
    throw new Error(e.message || 'insertRequest failed');
  }
}

/* ──────────────────────────────────────────────────────────────
 * ANALYTICS CORE FUNCTIONS (aligned with /analytics/full)
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
    .filter((r) => r.created_at && r.acknowledged_at)
    .map((r) => (new Date(r.acknowledged_at) - new Date(r.created_at)) / 60000);
  if (!times.length) return 0;
  return parseFloat((times.reduce((a, b) => a + b, 0) / times.length).toFixed(2));
}

export async function getMissedSLACount(startDate, endDate, hotelId) {
  const SLA_MS = 10 * 60 * 1000; // 10 minutes
  const { data, error } = await supabase
    .from('requests')
    .select('created_at, acknowledged_at')
    .eq('hotel_id', hotelId)
    .gte('created_at', startDate)
    .lte('created_at', endDate);
  if (error) throw new Error(error.message);
  return data.filter(
    (r) => !r.acknowledged_at || new Date(r.acknowledged_at) - new Date(r.created_at) > SLA_MS
  ).length;
}

// Requests by Hour (0–23), local-time aware via offset minutes
export async function getRequestsByHour(startDate, endDate, hotelId, tzOffsetMinutes = -300) {
  const { data, error } = await supabase
    .from('requests')
    .select('created_at')
    .eq('hotel_id', hotelId)
    .gte('created_at', startDate)
    .lte('created_at', endDate);
  if (error) throw new Error(error.message);

  const buckets = Array.from({ length: 24 }, (_, h) => ({ hour: h, count: 0 }));
  for (const { created_at } of data) {
    const local = shiftToLocal(created_at, tzOffsetMinutes);
    const hourLocal = local.getUTCHours(); // after shifting, UTC hours == local hours
    buckets[hourLocal].count++;
  }
  return buckets;
}

// Normalize a few variants safely
const _normSent = (s) => {
  const v = String(s || '').toLowerCase();
  if (v.startsWith('pos')) return 'positive';
  if (v.startsWith('neg')) return 'negative';
  if (v.startsWith('neu')) return 'neutral';
  return 'neutral';
};

// Sentiment breakdown for the whole range
export async function getSentimentBreakdown(startDate, endDate, hotelId) {
  const { data, error } = await supabase
    .from('requests')
    .select('sentiment')
    .eq('hotel_id', hotelId)
    .gte('created_at', startDate)
    .lte('created_at', endDate);
  if (error) throw new Error(error.message);

  const counts = { positive: 0, neutral: 0, negative: 0 };
  for (const r of data) counts[_normSent(r.sentiment)]++;

  return counts; // { positive, neutral, negative }
}

// Sentiment trend by day (local-time aware)
export async function getSentimentTrend(startDate, endDate, hotelId, tzOffsetMinutes = -300) {
  const { data, error } = await supabase
    .from('requests')
    .select('created_at,sentiment')
    .eq('hotel_id', hotelId)
    .gte('created_at', startDate)
    .lte('created_at', endDate);
  if (error) throw new Error(error.message);

  const byDay = new Map(); // date -> { positive, neutral, negative }
  for (const { created_at, sentiment } of data) {
    const local = shiftToLocal(created_at, tzOffsetMinutes).toISOString().slice(0, 10);
    if (!byDay.has(local)) byDay.set(local, { positive: 0, neutral: 0, negative: 0 });
    const bucket = byDay.get(local);
    bucket[_normSent(sentiment)]++;
  }

  return [...byDay.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, obj]) => ({ date, ...obj })); // [{ date, positive, neutral, negative }]
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
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([name, value]) => ({ name, value }));
}

// Common request words (light normalization + stoplist + frequency floor)
export async function getCommonRequestWords(startDate, endDate, hotelId, options = {}) {
  const { topN = 5, minLen = 3, minCount = 2 } = options;

  const stopwords = new Set([
    'i','me','my','you','your','we','us','our','they','them','he','she','it','their','yall',
    'hi','hey','hello','good','morning','afternoon','evening','night','thanks','thank','please','pls','ok','okay','yeah','yep','nope',
    'need','want','would','like','get','send','bring','have','do','can','could','is','are','be','was','were','am','has','had','will','may','might','must','should','shall','make','made','making','give','given','help','let','just','also','still','again',
    'a','an','the','to','in','on','for','from','of','at','as','by','with','about','into','onto','over','under','out','up','down','off','through','around','between','and','or','but','if','so','not','no','yes','that','this','there','which','what','when','who','whom','where','why','how',
    'today','tonight','tomorrow','soon','later','before','after','now','tonite',
    'room','suite','number','door','key','keys','card','cards','service','front','desk','guest','hotel',
  ]);

  const normalize = (w) => {
    if (!w) return '';
    let s = w.toLowerCase();
    s = s.replace(/wi[-\s]?fi/g, 'wifi');
    s = s.replace(/[^a-z]/g, '');
    if (!s) return '';
    if (s.length > 4 && s.endsWith('es')) s = s.slice(0, -2);
    else if (s.length > 3 && s.endsWith('s')) s = s.slice(0, -1);
    return s;
  };

  const { data, error } = await supabase
    .from('requests')
    .select('message')
    .eq('hotel_id', hotelId)
    .gte('created_at', startDate)
    .lte('created_at', endDate);
  if (error) throw new Error(error.message);

  const counts = new Map();
  for (const { message } of data) {
    if (!message) continue;
    const tokens = message.split(/\b/);
    for (const t of tokens) {
      const w = normalize(t);
      if (!w || w.length < minLen) continue;
      if (stopwords.has(w)) continue;
      if (/\d/.test(w)) continue;
      counts.set(w, (counts.get(w) || 0) + 1);
    }
  }

  const filtered = [...counts.entries()].filter(([_, c]) => c >= minCount);
  filtered.sort((a, b) => b[1] - a[1]);
  return filtered.slice(0, topN).map(([word, count]) => ({ word, count }));
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
  const repeatGuests = Object.values(counts).filter((c) => c > 1).length;
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
  return data.reduce((sum, r) => sum + (r.estimated_revenue || 0), 0);
}

// Labor time saved (minutes) — conservative default model
export async function getLaborTimeSaved(startDate, endDate, hotelId) {
  const total = await getTotalRequests(startDate, endDate, hotelId);
  const MINUTES_SAVED_PER_REQUEST = 4;
  return total * MINUTES_SAVED_PER_REQUEST;
}
export const getEnhancedLaborTimeSaved = getLaborTimeSaved;

export async function getServiceScoreEstimate(startDate, endDate, hotelId) {
  const { data, error } = await supabase
    .from('requests')
    .select('created_at, acknowledged_at')
    .eq('hotel_id', hotelId)
    .gte('created_at', startDate)
    .lte('created_at', endDate);
  if (error) throw new Error(error.message);
  const scores = data.map((r) => {
    if (!r.acknowledged_at) return 50;
    const secs = (new Date(r.acknowledged_at) - new Date(r.created_at)) / 1000;
    if (secs <= 300) return 100;
    if (secs <= 600) return 90;
    if (secs <= 1200) return 80;
    return 60;
  });
  return scores.length
    ? parseFloat((scores.reduce((a, b) => a + b) / scores.length).toFixed(2))
    : 0;
}

export async function getServiceScoreTrend(startDate, endDate, hotelId) {
  const { data, error } = await supabase
    .from('requests')
    .select('created_at, acknowledged_at')
    .eq('hotel_id', hotelId)
    .gte('created_at', startDate)
    .lte('created_at', endDate);
  if (error) throw new Error(error.message);
  const byWeek = {};
  data.forEach((r) => {
    const d = new Date(r.created_at);
    const year = d.getUTCFullYear();
    const weekNum = Math.ceil(
      ((d - new Date(year, 0, 1)) / 86400000 + new Date(year, 0, 1).getUTCDay() + 1) / 7
    );
      // simple score model
    const secs = r.acknowledged_at
      ? (new Date(r.acknowledged_at) - new Date(r.created_at)) / 1000
      : null;
    const score = secs == null ? 50 : secs <= 300 ? 100 : secs <= 600 ? 90 : secs <= 1200 ? 80 : 60;
    const week = `${year}-W${String(weekNum).padStart(2, '0')}`;
    if (!byWeek[week]) byWeek[week] = [];
    byWeek[week].push(score);
  });
  return Object.entries(byWeek)
    .sort()
    .map(([period, arr]) => ({
      period,
      avgServiceScore: parseFloat((arr.reduce((a, b) => a + b) / arr.length).toFixed(2)),
    }));
}

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

export async function getAvgCompletionTime(startDate, endDate, hotelId) {
  const { data, error } = await supabase
    .from('requests')
    .select('created_at,completed_at')
    .eq('hotel_id', hotelId)
    .gte('created_at', startDate)
    .lte('created_at', endDate);
  if (error) throw new Error(error.message);
  const diffs = data
    .filter((r) => r.completed_at)
    .map((r) => (new Date(r.completed_at) - new Date(r.created_at)) / 60000);
  return diffs.length ? parseFloat((diffs.reduce((a, b) => a + b) / diffs.length).toFixed(2)) : 0;
}

export async function getRepeatGuestTrend(startDate, endDate, hotelId) {
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
  data.forEach((r) => {
    const d = new Date(r.created_at);
    const year = d.getUTCFullYear();
    const weekNum = Math.ceil(
      ((d - new Date(year, 0, 1)) / 86400000 + new Date(year, 0, 1).getUTCDay() + 1) / 7
    );
    const week = `${year}-W${String(weekNum).padStart(2, '0')}`;
    totals[week] = (totals[week] || 0) + 1;
    counts[r.from_phone] = (counts[r.from_phone] || 0) + 1;
    if (counts[r.from_phone] > 1) repeat[week] = (repeat[week] || 0) + 1;
  });
  return Object.entries(totals)
    .sort()
    .map(([period, total]) => ({
      period,
      repeatPct: parseFloat((((repeat[period] || 0) / total) * 100).toFixed(2)),
    }));
}

export async function getRequestsPerOccupiedRoom(startDate, endDate, hotelId) {
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
  reqs.forEach((r) => {
    const d = r.created_at.slice(0, 10);
    countsPer[d] = (countsPer[d] || 0) + 1;
  });
  return occ.map((o) => ({
    date: o.date,
    requestsPerRoom: o.occupied_rooms
      ? parseFloat(((countsPer[o.date] || 0) / o.occupied_rooms).toFixed(2))
      : 0,
  }));
}

export async function getDailyCompletionRate(startDate, endDate, hotelId) {
  const { data, error } = await supabase
    .from('requests')
    .select('created_at,completed_at')
    .eq('hotel_id', hotelId)
    .gte('created_at', startDate)
    .lte('created_at', endDate);
  if (error) throw new Error(error.message);
  const byDay = {};
  data.forEach(({ created_at, completed_at }) => {
    const day = created_at.slice(0, 10);
    if (!byDay[day]) byDay[day] = { total: 0, completed: 0 };
    byDay[day].total++;
    if (completed_at) byDay[day].completed++;
  });
  return Object.entries(byDay).map(([date, { total, completed }]) => ({
    date,
    completionRate: parseFloat(((completed / total) * 100).toFixed(2)),
  }));
}

export async function getWeeklyCompletionRate(startDate, endDate, hotelId) {
  const { data, error } = await supabase
    .from('requests')
    .select('created_at,completed_at')
    .eq('hotel_id', hotelId)
    .gte('created_at', startDate)
    .lte('created_at', endDate);
  if (error) throw new Error(error.message);
  const byWeek = {};
  data.forEach(({ created_at, completed_at }) => {
    const d = new Date(created_at);
    const year = d.getUTCFullYear();
    const weekNum = Math.ceil(
      ((d - new Date(year, 0, 1)) / 86400000 + new Date(year, 0, 1).getUTCDay() + 1) / 7
    );
    const week = `${year}-W${String(weekNum).padStart(2, '0')}`;
    if (!byWeek[week]) byWeek[week] = { total: 0, completed: 0 };
    byWeek[week].total++;
    if (completed_at) byWeek[week].completed++;
  });
  return Object.entries(byWeek)
    .sort()
    .map(([period, { total, completed }]) => ({
      period,
      completionRate: parseFloat(((completed / total) * 100).toFixed(2)),
    }));
}

export async function getMonthlyCompletionRate(startDate, endDate, hotelId) {
  const { data, error } = await supabase
    .from('requests')
    .select('created_at,completed_at')
    .eq('hotel_id', hotelId)
    .gte('created_at', startDate)
    .lte('created_at', endDate);
  if (error) throw new Error(error.message);
  const byMonth = {};
  data.forEach(({ created_at, completed_at }) => {
    const month = created_at.slice(0, 7);
    if (!byMonth[month]) byMonth[month] = { total: 0, completed: 0 };
    byMonth[month].total++;
    if (completed_at) byMonth[month].completed++;
  });
  return Object.entries(byMonth)
    .sort()
    .map(([period, { total, completed }]) => ({
      period,
      completionRate: parseFloat(((completed / total) * 100).toFixed(2)),
    }));
}

/* ──────────────────────────────────────────────────────────────
 * DEPARTMENT SETTINGS / HOTEL PROFILE (used by classifier.js too)
 */
export async function getEnabledDepartments(hotelId) {
  const { data, error } = await supabase
    .from('department_settings')
    .select('department, enabled')
    .eq('hotel_id', hotelId);

  if (error) throw new Error(`getEnabledDepartments: ${error.message}`);

  const enabled = (data || [])
    .filter(
      (row) =>
        row.enabled === true ||
        row.enabled === 'true' ||
        row.enabled === 'TRUE' ||
        row.enabled === 1 ||
        row.enabled === '1'
    )
    .map((row) => row.department);

  return enabled;
}

export async function updateDepartmentToggle(hotelId, department, enabled) {
  const { error } = await supabase
    .from('department_settings')
    .upsert(
      { hotel_id: hotelId, department, enabled },
      { onConflict: 'hotel_id,department' }
    );
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
  // keep shape { data, error } (classifier expects destructuring { data: hotel })
  return { data, error };
}

export async function updateHotelProfile(hotelId, updates) {
  const { error } = await supabase.from('hotels').update(updates).eq('id', hotelId);
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
  const payload = Object.entries(slaMap).map(
    ([department, { ack_time, res_time, is_active }]) => ({
      hotel_id: hotelId,
      department,
      ack_time_minutes: ack_time,
      res_time_minutes: res_time,
      is_active,
    })
  );
  const { data, error } = await supabase
    .from('sla_settings')
    .upsert(payload, { onConflict: 'hotel_id,department' });
  return { data, error };
}

// Suggested indexes (run once in Supabase SQL):
// CREATE UNIQUE INDEX IF NOT EXISTS uniq_requests_telnyx_id
//   ON public.requests (telnyx_id) WHERE telnyx_id IS NOT NULL;
// CREATE INDEX IF NOT EXISTS idx_requests_hotel_created_at ON public.requests (hotel_id, created_at);
// CREATE INDEX IF NOT EXISTS idx_requests_open_hotel ON public.requests (hotel_id) WHERE completed = false;
// CREATE INDEX IF NOT EXISTS idx_guests_hotel_phone ON public.guests (hotel_id, phone_number);
