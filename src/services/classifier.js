// src/services/classifier.js
import OpenAI from 'openai';
import { openAIApiKey } from '../config/index.js';
import { getEnabledDepartments, getHotelProfile } from './supabaseService.js';

const openai = new OpenAI({ apiKey: openAIApiKey });

/* ----------------------------------------------
   Keyword override maps for each property type
-----------------------------------------------*/
const keywordMapByType = {
  hotel: [
    { keywords: ['wifi','wi-fi','internet','network'], department: 'IT' },
    { keywords: ['massage','spa','treatment'], department: 'Spa' },
    { keywords: ['bags','luggage','suitcase'], department: 'Bellhop' },
    { keywords: ['towel','sheets','cleaning','housekeep'], department: 'Housekeeping' },
    { keywords: ['broken','leak','repair','fix','maintenance'], department: 'Maintenance' },
    { keywords: ['car','valet','parking'], department: 'Valet' },
    { keywords: ['recommend','recommendation','nearby','suggest'], department: 'Concierge' },
    { keywords: ['reservation','book','cancel'], department: 'Reservations' },
    { keywords: ['laundry','dry clean','pressing'], department: 'Laundry' },
    { keywords: ['security','lost','safety','disturbance'], department: 'Security' },
    { keywords: ['menu','drink','restaurant','bar','food'], department: 'Food & Beverage' },
  ],
  apartment: [
    { keywords: ['plumbing','leak','clog','drain'], department: 'Maintenance' },
    { keywords: ['power','electric','outlet','breaker'], department: 'Maintenance' },
    { keywords: ['rent','lease','leasing','application'], department: 'Leasing' },
    { keywords: ['lock','door','security','entry'], department: 'Security' },
    { keywords: ['trash','garbage'], department: 'Resident Services' },
    { keywords: ['package','mail'], department: 'Resident Services' },
    { keywords: ['amenities','pool','gym'], department: 'Concierge' },
    { keywords: ['parking','garage','space'], department: 'Parking' },
  ],
  condo: [
    { keywords: ['lock','door','security','entry'], department: 'Security' },
    { keywords: ['plumbing','leak','drip','clog'], department: 'Maintenance' },
    { keywords: ['elevator','lift','hvac','ac'], department: 'Maintenance' },
    { keywords: ['hoa','association','board','dues'], department: 'HOA' },
    { keywords: ['landscape','garden','lawn'], department: 'Landscaping' },
  ],
  restaurant: [
    { keywords: ['menu','order','dish','food'], department: 'Kitchen' },
    { keywords: ['table','host','hostess','reservation'], department: 'Host/Hostess' },
    { keywords: ['drink','bar','wine','cocktail'], department: 'Bar' },
    { keywords: ['clean','sanitation','cleanup','mop'], department: 'Cleaning' },
    { keywords: ['delivery','takeout','uber','grubhub'], department: 'Delivery' },
    { keywords: ['stock','inventory','supply','ingredients'], department: 'Inventory' },
    { keywords: ['reservation','book','cancel','booking'], department: 'Reservations' },
    { keywords: ['dishwash','dishes','plate','silverware'], department: 'Dishwashing' },
  ],
  default: [
    { keywords: ['issue','problem','help','assist'], department: 'Front Desk' },
  ],
};

function overrideDepartment(text, enabledDepartments, propertyType) {
  const lower = String(text || '').toLowerCase();
  const map = keywordMapByType[propertyType] || keywordMapByType.default;
  for (const { keywords, department } of map) {
    if (keywords.some((k) => lower.includes(k)) && enabledDepartments.includes(department)) {
      return department;
    }
  }
  return null;
}

/* ----------------------------------------------
   Priority normalization + guardrails
-----------------------------------------------*/
const PRIORITY_SYNONYMS = {
  low: 'low', minor: 'low', 'low-priority': 'low',
  normal: 'normal', medium: 'normal', routine: 'normal', standard: 'normal',
  high: 'urgent', urgent: 'urgent', critical: 'urgent', emergency: 'urgent',
};

function normalizePriority(input) {
  if (typeof input === 'string') {
    const s = input.toLowerCase().trim();
    if (PRIORITY_SYNONYMS[s]) return PRIORITY_SYNONYMS[s];
    if (/(urgent|critical|emergen|asap|immediate)/i.test(s)) return 'urgent';
    if (/(low|minor|no rush|whenever)/i.test(s)) return 'low';
  }
  if (typeof input === 'number' && isFinite(input)) {
    const n = input;
    if (n <= 1)       return n >= 0.75 ? 'urgent' : n <= 0.25 ? 'low' : 'normal'; // 0..1
    if (n <= 100)     return n >= 75   ? 'urgent' : n <= 25   ? 'low' : 'normal'; // 0..100
                      return n >= 2    ? 'urgent' : n <= 0    ? 'low' : 'normal'; // ordinal 0/1/2
  }
  return undefined;
}

const URGENT_RX =
  /(asap|urgent|immediat|right away|emergen|leak|flood|burst|overflow|no (power|heat|ac|air|water)|fire|smoke|gas|carbon monoxide|locked out|security|injur|bleed)/i;
const LOW_RX =
  /(no rush|whenever|if possible|when you can|at your convenience|tomorrow|later)/i;

function derivePriorityFromText(text = '') {
  const t = text.toLowerCase();
  if (URGENT_RX.test(t)) return 'urgent';
  if (LOW_RX.test(t)) return 'low';
  return 'normal';
}

/* ----------------------------------------------
   DEPARTMENT & PRIORITY CLASSIFICATION
-----------------------------------------------*/
export async function classify(text, hotelId) {
  console.log('🟦 Classifying message:', text);
  console.log('🏨 Hotel ID:', hotelId);

  // Hotel profile → property type
  const { data: hotel } = await getHotelProfile(hotelId);
  const propertyType = hotel?.type?.toLowerCase?.() || 'hotel';
  console.log('📋 Property type:', propertyType);

  // Enabled departments
  const enabled = await getEnabledDepartments(hotelId);
  if (!enabled?.length) {
    console.warn(`❌ No enabled departments for hotel ${hotelId}, defaulting.`);
    // Still derive a reasonable priority from text
    return { department: 'Front Desk', priority: derivePriorityFromText(text), room_number: null };
  }
  console.log('✅ Enabled departments:', enabled);

  // 1) Fast keyword override for department
  const forced = overrideDepartment(text, enabled, propertyType);
  if (forced) {
    console.log('🔁 Keyword override (department):', forced);
    // Ask AI to estimate priority (fallback to heuristic)
    let pr = 'normal';
    try {
      const enr = await enrichRequest(text);
      pr = normalizePriority(enr?.priority) || derivePriorityFromText(text);
    } catch {
      pr = derivePriorityFromText(text);
    }
    return { department: forced, priority: pr, room_number: null };
  }

  // 2) AI classify department + priority
  const departmentList = enabled.map((d, i) => `${i + 1}. ${d}`).join('\n');
  const prompt = `You are a ${propertyType} task classifier.

Choose the single most appropriate department from the list below:
${departmentList}

Respond ONLY with JSON:
{ "department":"<one of above>", "priority":"high|normal|low", "room_number":"<if any or null>" }

Message: "${text}"`;

  const res = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.2,
  });

  const raw = res.choices?.[0]?.message?.content ?? '';
  console.log('🔍 RAW OUTPUT:', raw);

  // Safe JSON parse (strip code fences or extra text)
  const match = raw.match(/\{[\s\S]*\}/);
  let parsed;
  try {
    parsed = JSON.parse(match ? match[0] : raw);
  } catch (e) {
    console.error('❌ JSON parsing error:', e);
    parsed = { department: 'Front Desk', priority: 'normal', room_number: null };
  }

  // Validate department
  if (!enabled.includes(parsed.department)) {
    console.warn(`🚫 "${parsed.department}" not enabled; defaulting to Front Desk.`);
    parsed.department = 'Front Desk';
  }

  // Normalize/guardrail priority
  let priority =
    normalizePriority(parsed.priority) ??
    normalizePriority(parsed.urgency) ??
    'normal';

  if (priority === 'normal') {
    // Only escalate/downgrade when model is neutral
    const hint = derivePriorityFromText(text);
    if (hint !== 'normal') priority = hint;
  }

  return {
    department: parsed.department,
    priority,
    room_number: parsed.room_number ?? null,
  };
}

/* ----------------------------------------------
   AI ENRICHMENT (used for AI priority on override)
-----------------------------------------------*/
export async function enrichRequest(text) {
  const prompt = `
You are an AI assistant for hotel operations.
Extract the following from the guest request:
- summary: 3-6 word actionable summary
- root_cause: concise phrase (e.g., "HVAC not working")
- sentiment: positive, neutral, or negative
- priority: urgent, normal, or low (based on urgency)
- needs_attention: true if management should review, else false

Respond ONLY with JSON in this format:
{
  "summary": "",
  "root_cause": "",
  "sentiment": "",
  "priority": "",
  "needs_attention": false
}

Guest request: "${text}"
`;

  const res = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.2,
  });

  const raw = res.choices?.[0]?.message?.content ?? '';
  console.log('🧠 Enrichment RAW OUTPUT:', raw);

  const match = raw.match(/\{[\s\S]*\}/);
  let parsed;
  try {
    parsed = JSON.parse(match ? match[0] : raw);
  } catch (e) {
    console.error('❌ Enrichment JSON parsing error:', e);
    parsed = {
      summary: null,
      root_cause: null,
      sentiment: null,
      priority: null,
      needs_attention: false,
    };
  }

  return parsed;
}
