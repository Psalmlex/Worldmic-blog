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

// Safety net: guarantees a call-to-action is present even if the model forgot or got cut off
function ensureCTA(content, topic) {
  if (/class=["']cta-final["']/i.test(content)) return content;
  const fallback = `<p class="cta-final"><strong>Ready to put this into practice? Start with just one step from this article today${topic ? ` around ${topic}` : ''} — small, consistent action beats waiting for the perfect plan.</strong></p>`;
  return content.trim() + '\n' + fallback;
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

// ─── Web search (Serper.dev) — lets Mica write about actual current events ───
// Language models only know what's in their training data; they can't know about
// anything that happened after their cutoff, or truly current news, without this.
async function webSearch(query) {
  const apiKey = await getSetting('serperApiKey');
  if (!apiKey) throw new Error('No web search API key set. Add a Serper.dev key in Admin → Settings → AI Configuration to enable news research.');
  try {
    const response = await axios.post('https://google.serper.dev/search', { q: query, num: 8 }, {
      headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
    });
    const organic = response.data?.organic || [];
    const news = response.data?.news || [];
    const results = [...news, ...organic].slice(0, 8).map(r => ({
      title: r.title, snippet: r.snippet || '', link: r.link, date: r.date || '',
    }));
    if (!results.length) throw new Error('No search results found for that topic');
    return results;
  } catch (err) {
    if (err.response) throw new Error(`Search failed: ${err.response.data?.message || err.response.status}`);
    throw err;
  }
}

function formatSearchResults(results) {
  return results.map((r, i) => `[${i + 1}] ${r.title}${r.date ? ` (${r.date})` : ''}\n${r.snippet}\nSource: ${r.link}`).join('\n\n');
}

// ─── Generate blog post content — a real editorial pipeline, not one-shot ────
// Stage 1: research + outline. Stage 2: write full draft following the outline.
// Stage 3: heavy rewrite pass — original insight, examples, voice. Stage 4: rhythm/
// repetition copy-edit + final metadata. Each stage is a separate model call so it
// can focus on doing one job well, the way a real editorial process works.
//
// topic: subject, OR leave blank and pass sourceUrl to write about a fetched page/product
// length: 'short' | 'medium' | 'long' (default 'long')
// useWebSearch: true researches the topic online first (needed for actual current events)
async function generatePost(topic, tone = '', category = 'General', options = {}) {
  const { length = 'long', sourceUrl = '', useWebSearch = false } = options;
  const wordTarget = WORD_TARGETS[length] || WORD_TARGETS.long;
  const toneInstruction = tone ? `Write in this personal tone/style: ${tone}` : 'Write in a professional, engaging blog tone.';

  let groundingContext = '';
  let effectiveTopic = topic;
  if (sourceUrl) {
    const fetched = await fetchUrlContent(sourceUrl);
    effectiveTopic = topic || fetched.title || 'the linked page';
    groundingContext += `\n\nSOURCE MATERIAL (researched from ${sourceUrl}, title: "${fetched.title}") — base the article's facts on this, don't invent details that contradict it:\n${fetched.text}`;
  }
  if (useWebSearch) {
    const results = await webSearch(effectiveTopic);
    groundingContext += `\n\nCURRENT WEB SEARCH RESULTS for "${effectiveTopic}" (use these for up-to-date facts — cite what's actually here, don't invent beyond it):\n${formatSearchResults(results)}`;
  }

  const voiceRules = `BANNED — these are the exact patterns that make writing scream "AI-generated." Do not use them:
- Opening with "In today's fast-paced world," "In today's digital age," "Navigating the world of X can feel overwhelming," or any variant of that throat-clearing setup.
- Formulaic transition words: "Moreover," "Furthermore," "Additionally," "It's important to note that," "In conclusion," "Overall," "At the end of the day."
- Hedge-everything balance ("there are pros and cons to consider") where a real writer would just take a position.
- Wrapping nearly every idea in a bullet or numbered list. Most of the article should be flowing prose — only reach for a list when the content is genuinely a sequence or checklist.
- Restating the title's premise in the first sentence.
- A generic motivational wrap-up that could close any article on any topic.`;

  // ── Stage 1: Research + Outline ──
  const outlineSystem = `You are a senior editorial strategist for World Mic, planning an article before it's written. ${toneInstruction}
Think about what a genuinely informed writer would cover — not the generic angles everyone already uses. For each section, name a SPECIFIC, non-obvious angle: a mechanism, a tradeoff, a counter-intuitive point, or a concrete example — not just a topic label.
${groundingContext ? 'Ground the outline in the research context provided — use real specifics from it, not generic placeholders.' : ''}

Respond using EXACTLY this format, no other text, no JSON, no markdown fences:

[THESIS]One or two sentences: the specific, non-obvious point of view this article will take[/THESIS]
[SECTIONS]
1. Heading text | the specific angle/insight this section delivers (not a generic label)
2. Heading text | the specific angle/insight this section delivers
(continue for 5-7 sections total, in the order they should appear)
[/SECTIONS]`;
  const outlineResult = await callAI(outlineSystem, `Plan an article about: ${effectiveTopic}. Category: ${category}. Target length: ${wordTarget} words.${groundingContext}`, 1200);
  const outlineParsed = parseTaggedResponse(outlineResult, ['THESIS', 'SECTIONS']);
  const sectionLines = (outlineParsed.SECTIONS || '').split('\n').map(l => l.trim()).filter(l => /^\d+\./.test(l));
  const outlineText = sectionLines.length
    ? `Thesis: ${outlineParsed.THESIS}\nSections:\n${sectionLines.join('\n')}`
    : `Thesis: ${outlineParsed.THESIS || 'A specific, informed take on ' + effectiveTopic}`;

  // ── Stage 2: Write the full draft, section by section, following the outline ──
  const draftSystem = `You are a senior editorial writer for World Mic writing the full first draft from an approved outline. ${toneInstruction}
Write each section in full, delivering on the SPECIFIC angle the outline assigned it — don't flatten it back into generic advice.
${voiceRules}
- Open with something specific: a scene, a sharp claim, a concrete moment — not an announcement of the topic.
- At least one concrete, vivid scenario worked through in narrative prose. Frame invented scenarios as illustrative ("say someone...", "picture...") — never as a fabricated real person or verifiable case.
- Do NOT invent specific statistics, studies, or named-organization citations you cannot verify.
Target length: ${wordTarget} words total across all sections.

Respond with ONLY the HTML article body (using <h2>/<h3>/<p>, lists only where genuinely warranted) — no tags, no preamble, no markdown fences.`;
  const draft = await callAI(draftSystem, `Outline to follow:\n${outlineText}\n\nWrite the full article about: ${effectiveTopic}. Category: ${category}.${groundingContext}`, 5000);

  // ── Stage 3: Heavy rewrite — original insight, examples, distinctive voice ──
  const rewriteSystem = `You are a senior editor doing a heavy rewrite pass on a draft — not proofreading, substantially rewriting weak parts. ${toneInstruction}
For every paragraph, ask: "would a reasonably informed reader already know this?" If yes, rewrite it to go deeper — the mechanism behind why something works, the overlooked tradeoff, a sharper reframe.
Add at least one specific example, illustrative scenario, or concrete detail the draft is missing, if it reads generic anywhere.
Vary sentence rhythm — mix short punchy sentences with longer ones; real writing isn't uniform.
${voiceRules}
Do NOT invent specific statistics, studies, or named citations you cannot verify.

Respond with ONLY the rewritten HTML article body — no tags, no preamble, no markdown fences.`;
  const rewritten = await callAI(rewriteSystem, `Heavily rewrite this draft about "${effectiveTopic}":\n\n${draft}`, 5000);

  // ── Stage 4: Rhythm/repetition copy-edit + final metadata ──
  const polishSystem = `You are a copy editor doing the final pass on an article: fix rhythm, remove repeated phrases and words (especially repeated sentence openings and transition words), tighten anything wordy. Do not flatten the voice back into generic phrasing.
The article MUST end with a call-to-action as the very last element, wrapped exactly like this: <p class="cta-final"><strong>Your specific, concrete next step here.</strong></p> — tied to this specific topic, not generic. Add it if missing.
Then produce metadata for it. Identify 6-10 SEO keywords relevant to this topic and make sure the title/description use the primary one naturally.

Respond using EXACTLY this tagged format, no other text, no JSON, no markdown fences:

[TITLE]A compelling, specific title (no quotation marks, no curly braces)[/TITLE]
[EXCERPT]A plain-text summary, about 150-200 characters, no HTML[/EXCERPT]
[SEOTITLE]An SEO-optimized title, under 60 characters, including the primary keyword[/SEOTITLE]
[SEODESCRIPTION]An SEO meta description, under 160 characters, including the primary keyword[/SEODESCRIPTION]
[TAGS]tag one, tag two, tag three, tag four, tag five[/TAGS]
[CONTENT]
The final, polished HTML article body.
[/CONTENT]`;
  const result = await callAI(polishSystem, `Final copy-edit pass on this article about "${effectiveTopic}":\n\n${rewritten}`, 5500);
  const parsed = parseTaggedResponse(result, ['TITLE', 'EXCERPT', 'SEOTITLE', 'SEODESCRIPTION', 'TAGS', 'CONTENT']);

  if (parsed.TITLE && parsed.CONTENT) {
    const contentWithCTA = ensureCTA(parsed.CONTENT, effectiveTopic);
    return {
      title: parsed.TITLE,
      content: contentWithCTA,
      excerpt: parsed.EXCERPT || parsed.CONTENT.replace(/<[^>]+>/g, '').substring(0, 200),
      seoTitle: parsed.SEOTITLE || parsed.TITLE,
      seoDescription: parsed.SEODESCRIPTION || parsed.EXCERPT || '',
      tags: parsed.TAGS ? parsed.TAGS.split(',').map(t => t.trim()).filter(Boolean) : [],
    };
  }
  // Fallback if the final stage ignored the format — still return the rewritten draft rather than failing
  return { title: topic, content: ensureCTA(rewritten || draft, effectiveTopic), excerpt: (rewritten || draft).replace(/<[^>]+>/g, '').substring(0, 200), tags: [], seoTitle: topic, seoDescription: '' };
}

// ─── Re-edit existing post ────────────────────────────────────────────────────
async function reeditPost(existingContent, existingTitle, instructions = '') {
  const system = `You are a senior editor for World Mic, rewriting a draft that reads like generic AI output into something with a real editorial voice — not just polishing sentences. ${instructions ? 'Special instructions: ' + instructions : ''}

BANNED — remove these if present, they're what makes writing read as AI-generated:
- Throat-clearing openers ("In today's fast-paced world...", "Navigating X can feel overwhelming...").
- Formulaic transitions: "Moreover," "Furthermore," "Additionally," "It's important to note that," "In conclusion," "Overall."
- Wrapping nearly every point in a bullet list. Most of the piece should be flowing prose — only use lists for genuine sequences or scannable checklists.
- Hedge-everything balance instead of taking an actual position.
- A generic motivational closing that could end any article on any topic.

REQUIRED:
- Rewrite the opening to hook with something specific — a scene, a sharp claim, a concrete detail — not an announcement of the topic.
- Push past common-knowledge advice. Where the draft states something a reasonably informed reader already knows, add the reasoning, the mechanism, or the overlooked tradeoff behind it.
- Vary sentence rhythm — short and long sentences mixed, not uniform.
- Add at least one concrete scenario worked through in narrative prose (not a bulleted list of facts about it) if the draft doesn't already have one. Frame it as illustrative ("say someone...") — never as a fabricated real case.
- Give section headings specific, interesting phrasing instead of generic labels like "Introduction" or "Conclusion."
- Do NOT invent specific statistics, studies, or named-organization citations you cannot verify. Use general, well-established principles instead of fake specific numbers.
- The article MUST end with a call-to-action paragraph as the very last element, wrapped exactly like this: <p class="cta-final"><strong>Your specific, concrete next step here.</strong></p> — tied to this specific topic, not generic.
- Naturally weave in relevant SEO keywords for the topic through the headings and body.
- Aim for at least 1200 words in the improved version unless the topic is too narrow to responsibly support that without padding.

Respond using EXACTLY this tagged format, with no other text before, between, or after the tags. Do not use JSON. Do not wrap anything in markdown code fences:

[TITLE]Improved, specific post title (no quotation marks)[/TITLE]
[EXCERPT]A plain-text summary, about 150-200 characters, no HTML[/EXCERPT]
[SEOTITLE]An SEO-optimized title, under 60 characters, including the primary keyword[/SEOTITLE]
[SEODESCRIPTION]An SEO meta description, under 160 characters, including the primary keyword[/SEODESCRIPTION]
[TAGS]tag one, tag two, tag three, tag four, tag five[/TAGS]
[CONTENT]
Full improved HTML article body here, mostly flowing prose with a real voice, following the rules above.
[/CONTENT]`;

  const result = await callAI(system, `Rewrite this post titled "${existingTitle}" so it reads like a human editorial writer with a real point of view, not generic AI output:\n\n${existingContent}`, 6000);
  const parsed = parseTaggedResponse(result, ['TITLE', 'EXCERPT', 'SEOTITLE', 'SEODESCRIPTION', 'TAGS', 'CONTENT']);

  if (parsed.TITLE && parsed.CONTENT) {
    return {
      title: parsed.TITLE,
      content: ensureCTA(parsed.CONTENT, existingTitle),
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

module.exports = { callGroq, callGroqChat, callTextAI, chatWithAdmin, generatePost, reeditPost, generateCommentReply, getTrendingSuggestions, parseAdminCommand, generateImage, craftImagePrompt, generateFeaturedImage, fetchUrlContent, webSearch };
