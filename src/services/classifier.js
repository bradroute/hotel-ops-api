import OpenAI from 'openai';
import { openAIApiKey } from '../config/index.js';

const openai = new OpenAI({ apiKey: openAIApiKey });

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

