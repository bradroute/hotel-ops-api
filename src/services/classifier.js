// src/services/classifier.js
import { OpenAI } from 'openai';
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * Given a free-form message, returns an object
 * { department: string, priority: string }
 */
export async function classify(text) {
  const prompt = `You are a hotel task classifier. Given the message below, return JSON with two fields: "department" and "priority".

Departments: Housekeeping, Maintenance, Front Desk, Valet, Room Service  
Priorities: urgent, normal, low

Message: "${text}"`;

  const response = await openai.chat.completions.create({
    model: 'gpt-4',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.2
  });

  try {
    const content = response.choices[0].message.content;
    const { department, priority } = JSON.parse(content);
    return { department, priority };
  } catch (e) {
    console.error('Classification failed:', e);
    return { department: 'Front Desk', priority: 'normal' };
  }
}
