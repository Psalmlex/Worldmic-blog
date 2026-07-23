const axios = require('axios');
const { Settings } = require('../models/Models');

// Fallback: if the admin hasn't configured anything in Settings yet, Groq via .env still works
// out of the box (zero-config default, matches original behavior).
const ENV_GROQ_KEY = process.env.GROQ_API_KEY;

const TEXT_PROVIDER_DEFAULTS = {
  groq:       { url: 'https://api.groq.com/openai/v1/chat/completions', model: 'llama-3.3-70b-versatile' },
  openai:     { url: 'https://api.openai.com/v1/chat/completions',      model: 'gpt-4o-mini' },
  openrouter: { url: 'https://openrouter.ai/api/v1/chat/completions',   model: 'openai/gpt-4o-mini' },
  anthropic:  { url: 'https://api.anthropic.com/v1/messages',           model: 'claude-3-5-sonnet-20241022' },
};

async function getSetting(key) {
  const doc = await Settings.findOne({ key });
  return doc?.value;
}

// Which text-AI provider/key/model is currently configured (admin Settings, falling back to .env Groq)
async function getTextAIConfig() {
  const provider = (await getSetting('textAiProvider')) || 'groq';
  let apiKey = await getSetting('textAiKey');
  const customModel = await getSetting('textAiModel');
  if (!apiKey && provider === 'groq') apiKey = ENV_GROQ_KEY;
  const defaults = TEXT_PROVIDER_DEFAULTS[provider] || TEXT_PROVIDER_DEFAULTS.groq;
  return { provider, apiKey, model: (customModel && customModel.trim()) || defaults.model, url: defaults.url };
}

// Groq, OpenAI, and OpenRouter all speak the same OpenAI-compatible chat/completions format
async function callOpenAICompatible(url, apiKey, model, messages, maxTokens, extraHeaders = {}) {
  const response = await axios.post(url, { model, max_tokens: maxTokens, messages }, {
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', ...extraHeaders },
  });
  return response.data.choices[0].message.content;
}

// Anthropic uses a different shape: system prompt separate from the messages array
async function callAnthropic(apiKey, model, messages, maxTokens) {
  const systemMsg = messages.find(m => m.role === 'system');
  const convo = messages.filter(m => m.role !== 'system');
  const response = await axios.post('https://api.anthropic.com/v1/messages', {
    model, max_tokens: maxTokens, system: systemMsg?.content || undefined, messages: convo,
  }, {
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
  });
  return response.data.content?.[0]?.text || '';
}

// Universal entrypoint every text feature routes through
async function callTextAI(messages, maxTokens = 1500) {
  const { provider, apiKey, model, url } = await getTextAIConfig();
  if (!apiKey) {
    throw new Error(`No API key configured for "${provider}". Add one in Admin → Settings → AI Configuration, or set GROQ_API_KEY in your environment.`);
  }
  try {
    if (provider === 'anthropic') return (await callAnthropic(apiKey, model, messages, maxTokens)).trim();
    if (provider === 'openrouter') {
      return (await callOpenAICompatible(url, apiKey, model, messages, maxTokens, {
        'HTTP-Referer': 'https://worldmic-blog.onrender.com', 'X-Title': 'World Mic Blog',
      })).trim();
    }
    return (await callOpenAICompatible(url, apiKey, model, messages, maxTokens)).trim();
  } catch (err) {
    const status = err.response?.status;
    const msg = err.response?.data?.error?.message
      || err.response?.data?.message
      || (typeof err.response?.data?.error === 'string' ? err.response.data.error : null)
      || (status === 401 ? `Invalid or expired ${provider} API key — double check it in Admin → Settings → AI Configuration` : null)
      || (status === 429 ? `${provider} rate limit or quota exceeded` : null)
      || (status ? `${provider} returned HTTP ${status}` : null)
      || err.message;
    console.error(`${provider} AI error:`, err.response?.data || msg);
    throw new Error(msg);
  }
}

// Convenience wrapper matching the old single-turn callGroq(system, user) signature
async function callAI(systemPrompt, userMessage, maxTokens = 1500) {
  return callTextAI([{ role: 'system', content: systemPrompt }, { role: 'user', content: userMessage }], maxTokens);
}

// Old names kept as aliases so nothing else has to change
const callGroq = callAI;
const callGroqChat = callTextAI;

// ─── Chat with the admin assistant (Mica) ──────────────────────────────────────
async function chatWithAdmin(message, history = []) {
  // Ground Mica in real, current blog data so answers are specific instead of generic
  let context = '';
  try {
    const Post = require('../models/Post');
    const { Comment, Subscriber } = require('../models/Models');
    const [posts, categories, pendingComments, subCount] = await Promise.all([
      Post.find({ status: 'published' }).sort({ createdAt: -1 }).limit(8).select('title category views likes createdAt'),
      Post.distinct('category'),
      Comment.countDocuments({ status: 'pending' }),
      Subscriber.countDocuments({ status: 'active' }),
    ]);
    context = `

CURRENT BLOG STATE (use this to give specific, grounded answers — never invent data that isn't here):
- Categories in use: ${categories.join(', ') || 'none yet'}
- Recent published posts: ${posts.map(p => `"${p.title}" (${p.category}, ${p.views} views, ${p.likes || 0} likes)`).join('; ') || 'none yet'}
- Pending comments awaiting moderation: ${pendingComments}
- Active newsletter subscribers: ${subCount}`;
  } catch { /* proceed without context if the DB lookup fails */ }

  const system = `You are Mica, the in-house AI assistant for the World Mic blog platform's admin panel — a specialist in THIS specific blog, not a generic chatbot.

YOUR JOB: help the admin with blog strategy, content ideas, writing, SEO, and day-to-day management questions. Always reason from the real data below rather than giving generic advice.

WHAT YOU CAN HELP WITH:
- Suggesting post topics based on the blog's existing categories and what's already been covered
- Blog writing, editing, and SEO guidance
- Drafting replies to reader comments
- Explaining site stats (views, likes, subscribers, pending comments) and what they mean
- Content strategy: posting cadence, category balance, what's underperforming and why

STYLE RULES:
- Be specific and concrete, never vague. If asked "what should I write about," name 2-3 actual topic ideas tied to the real categories below — never say generic things like "write about trending topics."
- If asked about performance, reference the actual numbers below, not hypotheticals.
- Prefer short paragraphs or bullet points over long essays, unless asked for depth.
- If a question is about something outside this blog's data (e.g. general knowledge), answer it normally and briefly.
${context}

Current date: ${new Date().toLocaleDateString()}.`;

  const messages = [
    { role: 'system', content: system },
    ...history.filter(h => h && h.role && h.content).map(h => ({ role: h.role === 'assistant' ? 'assistant' : 'user', content: h.content })),
    { role: 'user', content: message },
  ];
  const reply = await callTextAI(messages, 1200);
  return reply.trim();
}

// ─── Helper: parse a delimited-tag AI response into fields ────────────────────
// LLMs reliably break JSON when a field (like HTML content) contains quotes or newlines.
// Custom tags avoid that entire class of failure — no escaping required.
function parseTaggedResponse(raw, keys) {
  const result = {};
  for (const key of keys) {
    const re = new RegExp(`\\[${key}\\]([\\s\\S]*?)\\[/${key}\\]`, 'i');
    const match = raw.match(re);
    result[key] = match ? match[1].trim() : '';
  }
  return result;
}

// ─── Generate blog post content ───────────────────────────────────────────────
async function generatePost(topic, tone = '', category = 'General') {
  const toneInstruction = tone ? `Write in this personal tone/style: ${tone}` : 'Write in a professional, engaging blog tone.';
  const system = `You are a world-class blog writer for World Mic, a multi-category blog platform. ${toneInstruction}
Write SEO-friendly, engaging, well-structured HTML content with proper headings (h2, h3), paragraphs, and lists where appropriate.

Respond using EXACTLY this tagged format, with no other text before, between, or after the tags. Do not use JSON. Do not wrap anything in markdown code fences:

[TITLE]A compelling, professional post title (no quotation marks, no curly braces)[/TITLE]
[EXCERPT]A plain-text summary, about 150-200 characters, no HTML[/EXCERPT]
[SEOTITLE]An SEO-optimized title, under 60 characters[/SEOTITLE]
[SEODESCRIPTION]An SEO meta description, under 160 characters[/SEODESCRIPTION]
[TAGS]tag one, tag two, tag three[/TAGS]
[CONTENT]
Full HTML article body here, using <h2>, <h3>, <p>, <ul>/<li> as needed.
[/CONTENT]`;

  const result = await callAI(system, `Write a comprehensive blog post about: ${topic}. Category: ${category}`, 2500);
  const parsed = parseTaggedResponse(result, ['TITLE', 'EXCERPT', 'SEOTITLE', 'SEODESCRIPTION', 'TAGS', 'CONTENT']);

  if (parsed.TITLE && parsed.CONTENT) {
    return {
      title: parsed.TITLE,
      content: parsed.CONTENT,
      excerpt: parsed.EXCERPT || parsed.CONTENT.replace(/<[^>]+>/g, '').substring(0, 200),
      seoTitle: parsed.SEOTITLE || parsed.TITLE,
      seoDescription: parsed.SEODESCRIPTION || parsed.EXCERPT || '',
      tags: parsed.TAGS ? parsed.TAGS.split(',').map(t => t.trim()).filter(Boolean) : [],
    };
  }
  // Extremely rare fallback if the model ignores the format entirely
  return { title: topic, content: `<p>${result.replace(/\n/g, '</p><p>')}</p>`, excerpt: result.substring(0, 200), tags: [], seoTitle: topic, seoDescription: '' };
}

// ─── Re-edit existing post ────────────────────────────────────────────────────
async function reeditPost(existingContent, existingTitle, instructions = '') {
  const system = `You are an expert blog editor for World Mic. Improve the given blog post: fix grammar, improve flow, enhance SEO, add better structure with HTML headings and paragraphs. ${instructions ? 'Special instructions: ' + instructions : ''}

Respond using EXACTLY this tagged format, with no other text before, between, or after the tags. Do not use JSON. Do not wrap anything in markdown code fences:

[TITLE]Improved post title (no quotation marks)[/TITLE]
[EXCERPT]A plain-text summary, about 150-200 characters, no HTML[/EXCERPT]
[SEOTITLE]An SEO-optimized title, under 60 characters[/SEOTITLE]
[SEODESCRIPTION]An SEO meta description, under 160 characters[/SEODESCRIPTION]
[TAGS]tag one, tag two, tag three[/TAGS]
[CONTENT]
Full improved HTML article body here.
[/CONTENT]`;

  const result = await callAI(system, `Re-edit this post titled "${existingTitle}":\n\n${existingContent}`, 2500);
  const parsed = parseTaggedResponse(result, ['TITLE', 'EXCERPT', 'SEOTITLE', 'SEODESCRIPTION', 'TAGS', 'CONTENT']);

  if (parsed.TITLE && parsed.CONTENT) {
    return {
      title: parsed.TITLE,
      content: parsed.CONTENT,
      excerpt: parsed.EXCERPT || parsed.CONTENT.replace(/<[^>]+>/g, '').substring(0, 200),
      seoTitle: parsed.SEOTITLE || parsed.TITLE,
      seoDescription: parsed.SEODESCRIPTION || '',
      tags: parsed.TAGS ? parsed.TAGS.split(',').map(t => t.trim()).filter(Boolean) : [],
    };
  }
  return { title: existingTitle, content: `<p>${result.replace(/\n/g, '</p><p>')}</p>`, excerpt: '' };
}

// ─── Auto-reply to comment ────────────────────────────────────────────────────
async function generateCommentReply(postTitle, commentContent, commenterName) {
  const system = `You are the friendly, professional admin of World Mic blog. Write a warm, helpful, and genuine reply to a reader's comment. Keep it 2-4 sentences. Be personal and engaging. Respond with plain text only — no tags, no formatting.`;
  const reply = await callAI(system, `Post: "${postTitle}"\nCommenter (${commenterName}): ${commentContent}\nWrite a reply:`);
  return reply.trim();
}

// ─── Trending topic suggestions ───────────────────────────────────────────────
async function getTrendingSuggestions(existingCategories = []) {
  const system = `You are a content strategist for World Mic, a multi-category blog. Suggest 5 trending blog post topics.

Respond using EXACTLY this format, one block per idea, no other text before/after, no JSON, no markdown fences:

[IDEA]
[TOPIC]The post topic[/TOPIC]
[CATEGORY]Suggested category[/CATEGORY]
[REASON]Why it's trending right now, one sentence[/REASON]
[URGENCY]high, medium, or low[/URGENCY]
[/IDEA]
(repeat this [IDEA] block 5 times total)`;

  const result = await callAI(system, `Existing categories: ${existingCategories.join(', ')}. Suggest 5 trending post topics for today.`, 1200);
  const blocks = result.match(/\[IDEA\][\s\S]*?\[\/IDEA\]/gi) || [];
  const suggestions = blocks.map(block => {
    const p = parseTaggedResponse(block, ['TOPIC', 'CATEGORY', 'REASON', 'URGENCY']);
    return { topic: p.TOPIC, category: p.CATEGORY, reason: p.REASON, urgency: (p.URGENCY || 'medium').toLowerCase() };
  }).filter(s => s.topic);
  return suggestions;
}

// ─── Parse admin command ──────────────────────────────────────────────────────
async function parseAdminCommand(command) {
  const system = `You are an AI assistant for World Mic blog admin panel. Parse the admin's natural language command and return the intent.

Respond using EXACTLY this format, no other text, no JSON, no markdown fences:

[ACTION]one of: create_post, edit_post, delete_post, reply_comments, suggest_trending, update_settings, manage_ad, generate_image, unknown[/ACTION]
[SUMMARY]short human-readable summary of what you'll do[/SUMMARY]
[APPROVAL]true or false — true for delete, publish, or settings changes[/APPROVAL]`;

  const result = await callAI(system, `Admin command: "${command}"`);
  const parsed = parseTaggedResponse(result, ['ACTION', 'SUMMARY', 'APPROVAL']);
  return {
    action: parsed.ACTION || 'unknown',
    params: {},
    requiresApproval: /true/i.test(parsed.APPROVAL || ''),
    summary: parsed.SUMMARY || 'Could not parse command',
  };
}

// ─── Image generation (multi-provider: Stability AI, OpenAI DALL-E, OpenRouter) ──
async function getImageAIConfig() {
  const provider = (await getSetting('imageApiProvider')) || 'stability';
  const apiKey = await getSetting('imageApiKey');
  return { provider, apiKey };
}

async function generateImage(prompt) {
  if (!prompt || !prompt.trim()) return { error: 'Please provide a description for the image.' };
  const { provider, apiKey } = await getImageAIConfig();
  if (!apiKey) {
    return { error: 'No image generation API key set. Add one in Admin → Settings → AI Configuration.' };
  }
  try {
    let base64, imageUrl;

    if (provider === 'openai') {
      const response = await axios.post('https://api.openai.com/v1/images/generations', {
        model: 'dall-e-3', prompt, n: 1, size: '1024x1024', response_format: 'b64_json',
      }, { headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' } });
      base64 = response.data?.data?.[0]?.b64_json;

    } else if (provider === 'openrouter') {
      const response = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
        model: 'google/gemini-2.5-flash-image-preview',
        messages: [{ role: 'user', content: prompt }],
        modalities: ['image', 'text'],
      }, { headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' } });
      const imgField = response.data?.choices?.[0]?.message?.images?.[0]?.image_url?.url;
      if (imgField?.startsWith('data:image')) base64 = imgField.split(',')[1];
      else if (imgField) imageUrl = imgField;

    } else { // stability (default)
      const response = await axios.post(
        'https://api.stability.ai/v1/generation/stable-diffusion-xl-1024-v1-0/text-to-image',
        { text_prompts: [{ text: prompt }], cfg_scale: 7, height: 1024, width: 1024, samples: 1, steps: 30 },
        { headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json' } }
      );
      base64 = response.data?.artifacts?.[0]?.base64;
    }

    if (!base64 && !imageUrl) return { error: 'Image generation returned no image. Try a different prompt or provider.' };

    const { cloudinary } = require('../../config/cloudinary');
    const source = base64 ? `data:image/png;base64,${base64}` : imageUrl;
    const upload = await cloudinary.uploader.upload(source, { folder: 'worldmic/ai-generated' });
    return { url: upload.secure_url };
  } catch (err) {
    const status = err.response?.status;
    const msg = err.response?.data?.error?.message
      || err.response?.data?.message
      || err.response?.data?.errors?.[0]
      || (status === 401 ? `Invalid ${provider} API key — check it in Admin → Settings → AI Configuration` : null)
      || err.message;
    console.error('Image generation error:', err.response?.data || msg);
    return { error: msg };
  }
}

module.exports = { callGroq, callGroqChat, callTextAI, chatWithAdmin, generatePost, reeditPost, generateCommentReply, getTrendingSuggestions, parseAdminCommand, generateImage };
