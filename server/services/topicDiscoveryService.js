// ─── Automatic topic discovery ──────────────────────────────────────────────
// Categories come entirely from AutoPublisherConfig.categories (admin-configured,
// never hard-coded). If none are configured, falls back to whatever categories
// already exist on published posts, so the bot still works out of the box.

const ai = require('./aiService'); // reuses the existing text-AI plumbing, not a new one
const Post = require('../models/Post');

function parseTagged(raw, keys) {
  const result = {};
  for (const key of keys) {
    const re = new RegExp(`\\[${key}\\]([\\s\\S]*?)\\[/${key}\\]`, 'i');
    const match = raw.match(re);
    result[key] = match ? match[1].trim() : '';
  }
  return result;
}

async function resolveCategoryPool(configuredCategories = []) {
  if (configuredCategories?.length) return configuredCategories;
  const existing = await Post.distinct('category', { status: 'published' });
  return existing.length ? existing : ['General'];
}

// Recently-used topics/categories are passed in so the model actively avoids
// repeating what was just covered (a first, cheap line of defense — the real
// duplicate protection is duplicateCheckService, run afterward against full posts).
async function discoverTopic({ categories = [], recentTopics = [] } = {}) {
  const pool = await resolveCategoryPool(categories);
  // Simple rotation weighted by least-recently-used category keeps coverage even
  // across all configured categories rather than always picking the first one.
  const category = pool[Math.floor(Math.random() * pool.length)];

  // The model's own sense of "recent" is frozen at its training cutoff, which is
  // often well in the past by the time this actually runs. Without being told the
  // real date, it tends to propose topics that were current when it was trained,
  // not topics that are current now — which is exactly the "researching past years"
  // problem. Anchoring to the real date fixes that at the source.
  const todayStr = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  const system = `You are a content strategist discovering ONE fresh, specific, publish-worthy blog topic for the category "${category}" on a global multi-category blog.

TODAY'S ACTUAL DATE IS ${todayStr}. This is the true, current, real-world date — your own training data has a cutoff well before this, so do NOT rely on your internal sense of what's "recent" or "trending." A topic that was current when you were trained is very likely stale now. Propose something that would make sense to publish on THIS actual date.
Strongly prefer genuinely current developments — something happening in or near the present moment — over evergreen topics. Only propose an evergreen topic if nothing recent and worthwhile comes to mind for this category. Do not propose anything generic, vague, already well-covered, or anchored to a year that has already passed.
${recentTopics.length ? `AVOID overlapping with these recently-covered topics: ${recentTopics.join('; ')}` : ''}

Respond using EXACTLY this format, no other text, no JSON, no markdown fences:

[TOPIC]A specific, concrete topic — not a vague category label. If it's a current-events topic, make the recency explicit in the topic itself (name what's actually happening now, not a generic evergreen framing)[/TOPIC]
[ANGLE]The specific angle or reason this is worth publishing right now, on ${todayStr}, one sentence[/ANGLE]
[NEEDS_CURRENT_INFO]true or false — true if this topic depends on recent/current facts that require a live web search to write accurately, false if it's evergreen and safe to write from general knowledge[/NEEDS_CURRENT_INFO]
[SENSITIVE]true or false — true if this topic touches health, finance, politics, breaking news, or legal advice and needs stricter validation before publishing[/SENSITIVE]`;

  const raw = await ai.callGroq(system, `Category: ${category}. Today is ${todayStr}. Discover one genuinely current topic.`, 400);
  const parsed = parseTagged(raw, ['TOPIC', 'ANGLE', 'NEEDS_CURRENT_INFO', 'SENSITIVE']);

  if (!parsed.TOPIC) throw new Error('Topic discovery failed: the AI did not return a usable topic.');

  return {
    topic: parsed.TOPIC,
    category,
    angle: parsed.ANGLE || '',
    needsCurrentInfo: /true/i.test(parsed.NEEDS_CURRENT_INFO || ''),
    sensitive: /true/i.test(parsed.SENSITIVE || ''),
  };
}

module.exports = { discoverTopic };
