const axios = require('axios');

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL   = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
const GROQ_URL     = 'https://api.groq.com/openai/v1/chat/completions';

// ─── Core Groq API call ───────────────────────────────────────────────────────
async function callGroq(systemPrompt, userMessage, maxTokens = 1500) {
  try {
    const response = await axios.post(GROQ_URL, {
      model: GROQ_MODEL,
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userMessage  },
      ],
    }, {
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'Content-Type':  'application/json',
      },
    });
    return response.data.choices[0].message.content;
  } catch (err) {
    console.error('Groq API error:', err.response?.data || err.message);
    throw new Error('AI service error: ' + (err.response?.data?.error?.message || err.message));
  }
}

// ─── Generate blog post content ───────────────────────────────────────────────
async function generatePost(topic, tone = '', category = 'General') {
  const toneInstruction = tone
    ? `Write in this personal tone/style: ${tone}`
    : 'Write in a professional, engaging blog tone.';

  const system = `You are a world-class blog writer for World Mic, a multi-category blog platform. ${toneInstruction}
Always write SEO-friendly, engaging, well-structured HTML content with proper headings (h2, h3), paragraphs, and where appropriate, lists.
Format your response as JSON with keys: title, content (HTML), excerpt (plain text, 200 chars), seoTitle, seoDescription, tags (array).
Return ONLY the raw JSON — no markdown fences, no preamble.`;

  const result = await callGroq(system, `Write a comprehensive blog post about: ${topic}. Category: ${category}`);
  try {
    const clean = result.replace(/```json|```/g, '').trim();
    return JSON.parse(clean);
  } catch {
    return { title: topic, content: result, excerpt: result.substring(0, 200), tags: [], seoTitle: topic, seoDescription: '' };
  }
}

// ─── Re-edit existing post ────────────────────────────────────────────────────
async function reeditPost(existingContent, existingTitle, instructions = '') {
  const system = `You are an expert blog editor for World Mic. Improve the given blog post: fix grammar, improve flow, enhance SEO, add better structure with HTML headings and paragraphs. ${instructions ? 'Special instructions: ' + instructions : ''}
Return JSON with keys: title, content (HTML), excerpt, seoTitle, seoDescription, tags (array).
Return ONLY the raw JSON — no markdown fences, no preamble.`;

  const result = await callGroq(system, `Re-edit this post titled "${existingTitle}":\n\n${existingContent}`, 2000);
  try {
    const clean = result.replace(/```json|```/g, '').trim();
    return JSON.parse(clean);
  } catch {
    return { title: existingTitle, content: result, excerpt: '' };
  }
}

// ─── Auto-reply to comment ────────────────────────────────────────────────────
async function generateCommentReply(postTitle, commentContent, commenterName) {
  const system = `You are the friendly, professional admin of World Mic blog. Write a warm, helpful, and genuine reply to a reader's comment. Keep it 2-4 sentences. Be personal and engaging.`;
  const reply = await callGroq(system, `Post: "${postTitle}"\nCommenter (${commenterName}): ${commentContent}\nWrite a reply:`);
  return reply.trim();
}

// ─── Trending topic suggestions ───────────────────────────────────────────────
async function getTrendingSuggestions(existingCategories = []) {
  const system = `You are a content strategist for World Mic, a multi-category blog. Suggest trending blog post topics.
Return JSON array of 5 objects with keys: topic, category, reason (why it's trending), urgency (high/medium/low).
Return ONLY the raw JSON — no markdown fences, no preamble.`;
  const result = await callGroq(system, `Existing categories: ${existingCategories.join(', ')}. Suggest 5 trending post topics for today.`);
  try {
    const clean = result.replace(/```json|```/g, '').trim();
    return JSON.parse(clean);
  } catch {
    return [];
  }
}

// ─── Parse admin command ──────────────────────────────────────────────────────
async function parseAdminCommand(command) {
  const system = `You are an AI assistant for World Mic blog admin panel. Parse the admin's natural language command and return the intent.
Return JSON with keys:
- action: one of [create_post, edit_post, delete_post, reply_comments, suggest_trending, update_settings, manage_ad, generate_image, unknown]
- params: object with relevant parameters extracted from the command
- requiresApproval: boolean (true for delete, publish, settings changes)
- summary: short human-readable summary of what you'll do
Return ONLY the raw JSON — no markdown fences, no preamble.`;

  const result = await callGroq(system, `Admin command: "${command}"`);
  try {
    const clean = result.replace(/```json|```/g, '').trim();
    return JSON.parse(clean);
  } catch {
    return { action: 'unknown', params: {}, requiresApproval: false, summary: 'Could not parse command' };
  }
}

// ─── Image generation (placeholder — wire in Stability/Replicate if needed) ──
async function generateImage(prompt) {
  return { url: '', error: 'Image generation not configured. Add a Stability AI or Replicate key to .env to enable this.' };
}

module.exports = { callGroq, generatePost, reeditPost, generateCommentReply, getTrendingSuggestions, parseAdminCommand, generateImage };
