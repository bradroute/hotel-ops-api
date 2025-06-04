const { OpenAI } = require('openai');
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function classify(text) {
  const prompt = `You are a hotel task classifier. Given the message below, return JSON with two fields: "department" and "priority".

Departments: housekeeping, maintenance, front desk, valet, room service
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
    return { department: 'front desk', priority: 'normal' }; // fallback
  }
}

module.exports = classify;
