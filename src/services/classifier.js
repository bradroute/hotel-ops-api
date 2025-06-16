// src/services/classifier.js

import OpenAI from 'openai';
import { openAIApiKey } from '../config/index.js';

const openai = new OpenAI({ apiKey: openAIApiKey });

export async function classify(text) {
  const prompt = `
You are a hotel task classifier.

Given the guest message below, return JSON only. Do not include any markdown, code blocks, or explanations.

Output JSON with these fields:
- "department" (Housekeeping, Maintenance, Front Desk, Valet, Room Service)
- "priority" (urgent, normal, low)
- "room_number" (extract the room number if mentioned, otherwise return null)

Message: "${text}"
`;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.2
  });

  try {
    const content = response.choices[0].message.content;
    const { department, priority, room_number } = JSON.parse(content);
    return { department, priority, room_number };
  } catch (e) {
    console.error('Classification failed:', e);
    return { department: 'Front Desk', priority: 'normal', room_number: null };
  }
}
