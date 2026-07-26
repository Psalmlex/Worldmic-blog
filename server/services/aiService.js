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

// ─── Fetch and extract readable text from a URL (for "write about this product/page") ──
async function fetchUrlContent(url) {
  try {
    const response = await axios.get(url, {
      timeout: 10000,
      maxRedirects: 5,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; WorldMicBot/1.0; +https://worldmic-blog.onrender.com)' },
      responseType: 'text',
    });
    let html = response.data;
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const pageTitle = titleMatch ? titleMatch[1].trim() : '';

    // Strip script/style/nav/footer/header blocks, then all remaining tags
    html = html.replace(/<script[\s\S]*?<\/script>/gi, '')
               .replace(/<style[\s\S]*?<\/style>/gi, '')
               .replace(/<nav[\s\S]*?<\/nav>/gi, '')
               .replace(/<footer[\s\S]*?<\/footer>/gi, '')
               .replace(/<header[\s\S]*?<\/header>/gi, '');
    const text = html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
                      .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();

    if (!text || text.length < 50) throw new Error('Could not extract readable content from that page');
    return { title: pageTitle, text: text.substring(0, 6000) };
  } catch (err) {
    if (err.code === 'ECONNABORTED') throw new Error('That page took too long to respond');
    if (err.response) throw new Error(`That page returned an error (${err.response.status})`);
    throw new Error('Could not fetch that URL — it may be blocking automated requests');
  }
}

const WORD_TARGETS = { short: '600-800', medium: '1000-1300', long: '1500-2000' };

// ─── Generate blog post content ───────────────────────────────────────────────
// topic: subject, OR leave blank and pass sourceUrl to write about a fetched page/product
// length: 'short' | 'medium' | 'long' (default 'long' — full, in-depth, SEO-ready articles)
async function generatePost(topic, tone = '', category = 'General', options = {}) {
  const { length = 'long', sourceUrl = '' } = options;
  const wordTarget = WORD_TARGETS[length] || WORD_TARGETS.long;
  const toneInstruction = tone ? `Write in this personal tone/style: ${tone}` : 'Write in a professional, engaging blog tone.';

  let sourceContext = '';
  let effectiveTopic = topic;
  if (sourceUrl) {
    const fetched = await fetchUrlContent(sourceUrl);
    effectiveTopic = topic || fetched.title || 'the linked page';
    sourceContext = `\n\nSOURCE MATERIAL (researched from ${sourceUrl}, title: "${fetched.title}") — base the article's facts on this, don't invent details that contradict it:\n${fetched.text}`;
  }

  const system = `You are a senior editorial writer for World Mic, producing articles that genuinely compete for search traffic — not generic filler. ${toneInstruction}

LENGTH: ${wordTarget} words. Do not pad with repetition to hit the count — every paragraph must add real value. If the topic is thin, go deeper into examples, mistakes, and how-to detail rather than restating the same point.

STRUCTURE (required):
- A hook opening paragraph that states why this matters to the reader right now — no throat-clearing ("In today's world...").
- 4-7 <h2> sections that each cover a distinct angle (context/background, core strategies, common mistakes, a worked example, practical takeaways). Use <h3> for sub-points within a section when it aids scanning.
- Any list of strategies, steps, tips, or mistakes MUST be an actual <ul>/<ol> with <li> items — never a wall of text pretending to be a list.
- At least one concrete, worked example or scenario (e.g. "Say someone earning $3,000/month starts by..."). Frame invented examples as illustrative ("for example," "imagine," "say someone...") — never present a fabricated person or company as if they were a real, verifiable case.
- End with a short, specific call to action — a concrete next step the reader can take today, not a vague "take control of your future."

SPECIFICITY (critical — this is what separates a professional article from generic filler):
- Every piece of advice needs a "how," not just a "what." Instead of "create a budget," explain a specific method (e.g. naming an approach, giving a simple worked split, or a step-by-step).
- Avoid generic statements that could apply to any article on the topic. If a sentence could be copy-pasted into a hundred other articles unchanged, rewrite it to be specific to this piece.
- Do NOT invent specific statistics, percentages, studies, or named-organization citations you cannot verify — fabricated numbers presented as fact are misleading to readers. Instead use precise, verifiable-sounding language for general, well-established principles ("most financial guidance suggests...", "a common rule of thumb is...") rather than a fake specific stat with a fake source.

SEO: Identify 6-10 relevant keywords/phrases a reader might search for this topic, and weave them naturally into the headings and body — never keyword-stuff or list them separately.

Respond using EXACTLY this tagged format, with no other text before, between, or after the tags. Do not use JSON. Do not wrap anything in markdown code fences:

[TITLE]A compelling, specific title (no quotation marks, no curly braces)[/TITLE]
[EXCERPT]A plain-text summary, about 150-200 characters, no HTML[/EXCERPT]
[SEOTITLE]An SEO-optimized title, under 60 characters, including the primary keyword[/SEOTITLE]
[SEODESCRIPTION]An SEO meta description, under 160 characters, including the primary keyword[/SEODESCRIPTION]
[TAGS]tag one, tag two, tag three, tag four, tag five[/TAGS]
[CONTENT]
Full HTML article body here, following the structure and specificity rules above. Aim for ${wordTarget} words.
[/CONTENT]`;

  const result = await callAI(system, `Write a comprehensive, in-depth, specific (not generic) article about: ${effectiveTopic}. Category: ${category}${sourceContext}`, 4500);
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
  const system = `You are a senior editor for World Mic, upgrading a draft into a genuinely competitive, professional article — not just polishing sentences. ${instructions ? 'Special instructions: ' + instructions : ''}

Fix grammar and flow, but more importantly:
- Expand generic or vague statements into specific, actionable guidance. If a sentence could apply to almost any article on this topic, rewrite it to be specific to this piece — add a concrete "how," an example, or a specific method.
- Restructure any list of tips/steps/mistakes that's written as a paragraph into a real <ul>/<ol> with <li> items.
- Add at least one concrete worked example or scenario if the draft doesn't already have one. Frame it as illustrative ("for example," "imagine") — never as a fabricated real case.
- Break the content into clear <h2> (and <h3> where useful) sections if it isn't already well-structured.
- Do NOT invent specific statistics, studies, or named-organization citations you cannot verify. Use general, well-established principles instead of fake specific numbers.
- End with a specific, actionable call to action.
- Naturally weave in relevant SEO keywords for the topic through the headings and body.
- Aim for at least 1200 words in the improved version unless the topic is too narrow to responsibly support that without padding.

Respond using EXACTLY this tagged format, with no other text before, between, or after the tags. Do not use JSON. Do not wrap anything in markdown code fences:

[TITLE]Improved, specific post title (no quotation marks)[/TITLE]
[EXCERPT]A plain-text summary, about 150-200 characters, no HTML[/EXCERPT]
[SEOTITLE]An SEO-optimized title, under 60 characters, including the primary keyword[/SEOTITLE]
[SEODESCRIPTION]An SEO meta description, under 160 characters, including the primary keyword[/SEODESCRIPTION]
[TAGS]tag one, tag two, tag three, tag four, tag five[/TAGS]
[CONTENT]
Full improved HTML article body here, following the structure and specificity rules above.
[/CONTENT]`;

  const result = await callAI(system, `Re-edit this post titled "${existingTitle}":\n\n${existingContent}`, 4500);
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

// ─── Turn a topic/post into a strong, on-brand image-generation prompt ────────
// A bare headline ("Cristiano Ronaldo: The Last Dance") is a weak prompt for an image
// model — it has no concrete scene to render. This step asks the text AI to describe
// an actual visual scene grounded in the post's real content instead.
async function craftImagePrompt(topic, contextText = '') {
  const system = `You write concise, vivid prompts for AI image generators (Stability AI / DALL-E) to create featured images for blog posts.
Rules:
- Describe a concrete visual SCENE: setting, objects, mood, lighting, color palette, composition. Do not restate the headline as a caption.
- Never include any text, words, letters, or logos to be rendered in the image.
- Never describe a specific real, named, identifiable person's face or likeness — even if the topic is about a real public figure, use symbolic/contextual imagery instead (e.g. for a footballer: a stadium, a ball mid-air, a trophy, a crowd silhouette — not a portrait of the individual). This keeps results both more reliable and safer.
- Style: professional editorial photography or clean modern illustration, suitable for a blog header image.
- Output ONE paragraph, 2-3 sentences, no preamble, no quotation marks.`;
  const userMsg = contextText
    ? `Blog post topic: "${topic}"\nContent context: ${contextText.substring(0, 600)}\n\nWrite the image prompt:`
    : `Blog post topic: "${topic}"\n\nWrite the image prompt:`;
  try {
    const prompt = await callAI(system, userMsg, 200);
    return prompt.trim().replace(/^["']|["']$/g, '');
  } catch {
    return topic; // fall back to the raw topic if prompt-crafting fails — generation still works, just less refined
  }
}

// High-level entrypoint: crafts a proper scene prompt, then generates the image from it
async function generateFeaturedImage(topic, contextText = '') {
  const craftedPrompt = await craftImagePrompt(topic, contextText);
  const result = await generateImage(craftedPrompt);
  return { ...result, promptUsed: craftedPrompt };
}

module.exports = { callGroq, callGroqChat, callTextAI, chatWithAdmin, generatePost, reeditPost, generateCommentReply, getTrendingSuggestions, parseAdminCommand, generateImage, craftImagePrompt, generateFeaturedImage, fetchUrlContent };
