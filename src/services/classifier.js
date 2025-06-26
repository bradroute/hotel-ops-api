// src/services/classifier.js
import OpenAI from 'openai';
import { openAIApiKey } from '../config/index.js';
import { getEnabledDepartments as fetchEnabled } from './supabaseService.js';

const openai = new OpenAI({ apiKey: openAIApiKey });

// Keyword → department mapping
const keywordMap = [
  { keywords: ['wifi', 'wi-fi', 'internet', 'network'], department: 'IT' },
  { keywords: ['massage', 'spa', 'treatment'], department: 'Spa' },
  { keywords: ['bags', 'luggage', 'suitcase'], department: 'Bellhop' },
  { keywords: ['towel', 'sheets', 'cleaning'], department: 'Housekeeping' },
  { keywords: ['broken', 'leak', 'repair', 'fix'], department: 'Maintenance' },
  { keywords: ['car', 'valet', 'parking'], department: 'Valet' },
  { keywords: ['recommend', 'recommendation', 'suggest', 'nearby'], department: 'Concierge' },
  { keywords: ['reservation', 'book', 'cancel'], department: 'Reservations' },
  { keywords: ['laundry', 'dry clean', 'pressing'], department: 'Laundry' },
  { keywords: ['security', 'lost', 'safety'], department: 'Security' },
  { keywords: ['restaurant', 'menu', 'drink'], department: 'Food & Beverage' }
];

function overrideDepartment(text, enabledDepartments) {
  const lower = text.toLowerCase();
  for (const { keywords, department } of keywordMap) {
    if (keywords.some(k => lower.includes(k)) && enabledDepartments.includes(department)) {
      return department;
    }
  }
  return null;
}

export async function classify(text, hotelId) {
  console.log('🟦 Classifying message:', text);
  console.log('🏨 Hotel ID:', hotelId);

  const enabled = await fetchEnabled(hotelId);
  console.log('📦 Raw fetchEnabled response:', enabled);

  if (!enabled || enabled.length === 0) {
    console.error(`❌ No enabled departments found for hotel ${hotelId}`);
    return {
      department: 'Front Desk',
      priority: 'normal',
      room_number: null
    };
  }

  const departments = enabled;
  console.log('✅ Enabled departments:', departments);

  const list = departments.join(', ');
  console.log('🧾 Department list used in prompt:', list);

  const prompt = `You are a hotel task classifier. Choose the single most appropriate department from: ${list}.

- IT: WiFi, internet or tech support.
- Bellhop: luggage, bags or escorting.
- Valet: cars or parking.
- Maintenance: broken, repair, leak.
- Room Service: food/drinks to room.
- Concierge: recommendations or arrangements.
- Spa: massages or wellness.
- Reservations: booking or cancellations.
- Laundry: washing or dry cleaning.
- Security: safety or disturbances.
- Food & Beverage: restaurants or bar queries.
- Events: meeting or event space.
- Housekeeping: towels, sheets, room cleaning.
- Engineering: HVAC, plumbing, elevator.
- Front Desk: general inquiries or fallback.

Respond ONLY with JSON:
{ "department": "<one of: ${list}>", "priority": "urgent|normal|low", "room_number": "<if found, else null>" }

Message: "${text}"`;

  const res = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.2
  });

  const raw = res.choices[0].message.content;
  console.log('🔍 RAW CLASSIFIER OUTPUT:\n', raw);

  const match = raw.match(/\{[\s\S]*\}/);
  const json = match ? match[0] : raw;
  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    console.error('❌ JSON parse error:', e);
    parsed = { department: 'Front Desk', priority: 'normal', room_number: null };
  }

  // Apply keyword override if allowed
  const forced = overrideDepartment(text, departments);
  if (forced) {
    console.log(`🔁 Keyword override: ${forced}`);
    parsed.department = forced;
  }

  // Ensure department is in the enabled list
  if (!departments.includes(parsed.department)) {
    console.log(`🚫 Disabled department "${parsed.department}", defaulting to Front Desk`);
    parsed.department = 'Front Desk';
  }

  return {
    department: parsed.department,
    priority: parsed.priority,
    room_number: parsed.room_number
  };
}
