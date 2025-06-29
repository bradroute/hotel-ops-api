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
    { keywords: ['plumbing','leak','clog','drain'], department: 'Maintenance' },
    { keywords: ['power','electric','outlet','breaker'], department: 'Maintenance' },
    { keywords: ['rent','lease','leasing','application'], department: 'Leasing' },
    { keywords: ['lock','door','security','entry'], department: 'Security' },
    { keywords: ['trash','garbage'], department: 'Resident Services' },
    { keywords: ['package','mail'], department: 'Resident Services' },
    { keywords: ['amenities','pool','gym'], department: 'Concierge' },
    { keywords: ['parking','garage','space'], department: 'Parking' }
  ],
  condo: [
    { keywords: ['lock','door','security','entry'], department: 'Security' },
    { keywords: ['plumbing','leak','drip','clog'], department: 'Maintenance' },
    { keywords: ['elevator','lift','hvac','ac'], department: 'Maintenance' },
    { keywords: ['hoa','association','board','dues'], department: 'HOA' },
    { keywords: ['landscape','garden','lawn'], department: 'Landscaping' }
  ],
  restaurant: [
    { keywords: ['menu','order','dish','food'], department: 'Kitchen' },
    { keywords: ['table','host','hostess','reservation'], department: 'Host/Hostess' },
    { keywords: ['drink','bar','wine','cocktail'], department: 'Bar' },
    { keywords: ['clean','sanitation','cleanup','mop'], department: 'Cleaning' },
    { keywords: ['delivery','takeout','uber','grubhub'], department: 'Delivery' },
    { keywords: ['stock','inventory','supply','ingredients'], department: 'Inventory' },
    { keywords: ['reservation','book','cancel','booking'], department: 'Reservations' },
    { keywords: ['dishwash','dishes','plate','silverware'], department: 'Dishwashing' }
  ],
  default: [
    { keywords: ['issue','problem','help','assist'], department: 'Front Desk' }
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

  // Fetch hotel type
  const { data: hotel } = await getHotelProfile(hotelId);
  const propertyType = hotel?.type?.toLowerCase() || 'hotel';
  console.log('📋 Property type:', propertyType);

  // Fetch enabled departments
  const enabled = await getEnabledDepartments(hotelId);
  if (!enabled.length) {
    console.warn(`❌ No enabled departments for hotel ${hotelId}, defaulting.`);
    return { department: 'Front Desk', priority: 'normal', room_number: null };
  }
  console.log('✅ Enabled departments:', enabled);

  // Keyword override
  const forced = overrideDepartment(text, enabled, propertyType);
  if (forced) {
    console.log('🔁 Keyword override:', forced);
    return { department: forced, priority: 'normal', room_number: null };
  }

  // Build prompt
  const departmentList = enabled.map((d, i) => `${i + 1}. ${d}`).join('\n');
  const prompt = `You are a ${propertyType} task classifier. \n\nChoose the single most appropriate department from the list below:\n${departmentList}\n\nRespond ONLY with JSON: { \"department\":\"<one of above>\", \"priority\":\"urgent|normal|low\", \"room_number\":\"<if any or null>\" }\n\nMessage: \"${text}\"`;

  // Call OpenAI
  const res = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.2
  });

  const raw = res.choices[0].message.content;
  console.log('🔍 RAW OUTPUT:', raw);

  // Parse JSON
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

  // Return standardized output
  return {
    department: parsed.department,
    priority: parsed.priority,
    room_number: parsed.room_number
  };
}
