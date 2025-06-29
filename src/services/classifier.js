// src/services/classifier.js
import OpenAI from 'openai';
import { openAIApiKey } from '../config/index.js';
import {
  getEnabledDepartments,
  getHotelProfile
} from './supabaseService.js';

const openai = new OpenAI({ apiKey: openAIApiKey });

// Keyword override maps for each property type
const keywordMapByType = {
  hotel: [
    { keywords: ['wifi','wi-fi','internet','network'], department: 'IT' },
    { keywords: ['massage','spa','treatment'], department: 'Spa' },
    { keywords: ['bags','luggage','suitcase'], department: 'Bellhop' },
    { keywords: ['towel','sheets','cleaning'], department: 'Housekeeping' },
    { keywords: ['broken','leak','repair','fix'], department: 'Maintenance' },
    { keywords: ['car','valet','parking'], department: 'Valet' },
    { keywords: ['recommend','recommendation','nearby','suggest'], department: 'Concierge' },
    { keywords: ['reservation','book','cancel'], department: 'Reservations' },
    { keywords: ['laundry','dry clean','pressing'], department: 'Laundry' },
    { keywords: ['security','lost','safety','disturbance'], department: 'Security' },
    { keywords: ['menu','drink','restaurant','bar'], department: 'Food & Beverage' }
  ],
  apartment: [
    { keywords: ['leak','plumbing','clog','drain'], department: 'Plumbing' },
    { keywords: ['power','electric','outlet','breaker'], department: 'Electrical' },
    { keywords: ['heater','ac','air conditioning','hvac'], department: 'HVAC' },
    { keywords: ['lock','door','security','entry'], department: 'Security' },
    { keywords: ['rent','lease','leasing','application'], department: 'Leasing' }
  ],
  condo: [
    { keywords: ['lock','door','security'], department: 'Security' },
    { keywords: ['plumbing','leak','drip'], department: 'Maintenance' },
    { keywords: ['lift','elevator','hvac','ac'], department: 'Engineering' }
  ],
  restaurant: [
    { keywords: ['menu','order','dish','food'], department: 'Front of House' },
    { keywords: ['kitchen','chef','cook','prep'], department: 'Back of House' },
    { keywords: ['repair','broken','maintenance'], department: 'Kitchen Maintenance' },
    { keywords: ['clean','sanitation','cleaning','cleanup'], department: 'Cleaning' },
    { keywords: ['power','electric','light','outlet'], department: 'Electrical' },
    { keywords: ['plumbing','leak','drip'], department: 'Plumbing' }
  ],
  // fallback map if type not listed
  default: [
    { keywords: ['issue','problem','help','assist'], department: 'General' }
  ]
};

function overrideDepartment(text, enabledDepartments, propertyType) {
  const lower = text.toLowerCase();
  const map = keywordMapByType[propertyType] || keywordMapByType.default;
  for (const { keywords, department } of map) {
    if (keywords.some(k => lower.includes(k)) && enabledDepartments.includes(department)) {
      return department;
    }
  }
  return null;
}

export async function classify(text, hotelId) {
  console.log('🟦 Classifying message:', text);
  console.log('🏨 Hotel ID:', hotelId);

  // 1) Fetch hotel to get its type
  const { data: hotel } = await getHotelProfile(hotelId);
  const propertyType = hotel?.type || 'hotel';
  console.log('📋 Property type:', propertyType);

  // 2) Fetch enabled departments for this hotel
  const enabled = await getEnabledDepartments(hotelId);
  if (!enabled.length) {
    console.warn(`❌ No enabled departments for hotel ${hotelId}, defaulting.`);
    return { department: 'Front Desk', priority: 'normal', room_number: null };
  }
  console.log('✅ Enabled departments:', enabled);

  // 3) Attempt keyword override
  const forced = overrideDepartment(text, enabled, propertyType);
  if (forced) {
    console.log('🔁 Keyword override:', forced);
    return { department: forced, priority: 'normal', room_number: null };
  }

  // 4) Build dynamic prompt for OpenAI
  const departmentList = enabled.map((d, i) => `${i + 1}. ${d}`).join('\n');
  const prompt = `
You are a ${propertyType} task classifier. Given the customer message below, choose the single most appropriate department from the list:
${departmentList}

Respond ONLY with valid JSON:
{
  "department": "<one of the above>",
  "priority": "urgent|normal|low",
  "room_number": "<if found, else null>"
}

Customer message:
"${text}"
`.trim();

  // 5) Call OpenAI
  const res = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.2
  });

  const raw = res.choices[0].message.content;
  console.log('🔍 RAW CLASSIFIER OUTPUT:', raw);

  // 6) Safely parse JSON
  const match = raw.match(/\{[\s\S]*\}/);
  let parsed;
  try {
    parsed = JSON.parse(match ? match[0] : raw);
  } catch (e) {
    console.error('❌ JSON parsing error:', e);
    parsed = { department: 'Front Desk', priority: 'normal', room_number: null };
  }

  // 7) Validate against enabled list
  if (!enabled.includes(parsed.department)) {
    console.warn(`🚫 Department "${parsed.department}" not enabled; defaulting to Front Desk.`);
    parsed.department = 'Front Desk';
  }

  return {
    department: parsed.department,
    priority: parsed.priority,
    room_number: parsed.room_number
  };
}
