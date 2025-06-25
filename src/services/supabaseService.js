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
  is_vip
}) {
  const estimated_revenue = estimateOrderRevenue(message);

  const { data: requestRows, error: reqErr } = await supabase
    .from('requests')
    .insert([{ hotel_id, from_phone, message, department, priority, room_number, telnyx_id, estimated_revenue, is_staff, is_vip }])
    .select();
  if (reqErr) throw new Error(reqErr.message);
  return requestRows[0];
}

export async function fetchAllRequests() {
  const { data: requests, error: reqErr } = await supabase
    .from('requests')
    .select('*')
    .order('created_at', { ascending: false });
  if (reqErr) throw new Error(reqErr.message);

  const { data: guests, error: guestErr } = await supabase
    .from('guests')
    .select('phone_number, is_vip');
  if (guestErr) throw new Error(guestErr.message);

  const { data: staff, error: staffErr } = await supabase
    .from('authorized_numbers')
    .select('phone, is_staff');
  if (staffErr) throw new Error(staffErr.message);

  const guestMap = Object.fromEntries(guests.map(g => [g.phone_number, g.is_vip]));
  const staffSet = new Set(staff.filter(s => s.is_staff).map(s => s.phone));

  return requests.map(r => ({
    ...r,
    is_vip: !!guestMap[r.from_phone],
    is_staff: staffSet.has(r.from_phone)
  }));
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
    'i','a','the','to','and','is','can','in','of','on','for','me','please','you',
    'get','my','with','need','it','hi','hey','would','like','that','just','do','we',
    'us','send','want','room','at','but','your','this','so','as','if','are','be','by',
    'from','or','not','no','yes','ok','okay','thanks','thank','hello','good','morning',
    'afternoon','evening','night','call','text','right','now','some'
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

/** ──────────────────────────────────────────────────────────────
 * PHASE 3: ROI METRICS
 */
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

export async function getLaborTimeSaved(startDate, endDate, hotelId) {
  const missed = await getMissedSLACount(startDate,endDate,hotelId);
  return missed * 2;
}

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

/** ──────────────────────────────────────────────────────────────
 * DEPARTMENT SETTINGS
 */
export async function getEnabledDepartments(hotelId) {
  const { data, error } = await supabase
    .from('department_settings')       // use actual table
    .select('department')             // select department column
    .eq('hotel_id', hotelId)
    .eq('enabled', true);
  if (error) throw new Error(`getEnabledDepartments: ${error.message}`);
  return data.map(r => r.department);
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
