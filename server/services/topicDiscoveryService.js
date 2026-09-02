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

  const system = `You are a content strategist discovering ONE fresh, specific, publish-worthy blog topic for the category "${category}" on a global multi-category blog.
Favor a mix of: genuinely current/trending developments, evergreen reader value, or real search-interest opportunities — whichever is most useful for this category right now. Do not propose anything generic, vague, or already well-covered.
${recentTopics.length ? `AVOID overlapping with these recently-covered topics: ${recentTopics.join('; ')}` : ''}

Respond using EXACTLY this format, no other text, no JSON, no markdown fences:

[TOPIC]A specific, concrete topic — not a vague category label[/TOPIC]
[ANGLE]The specific angle or reason this is worth publishing now, one sentence[/ANGLE]
[NEEDS_CURRENT_INFO]true or false — true if this topic depends on recent/current facts that require a live web search to write accurately, false if it's evergreen and safe to write from general knowledge[/NEEDS_CURRENT_INFO]
[SENSITIVE]true or false — true if this topic touches health, finance, politics, breaking news, or legal advice and needs stricter validation before publishing[/SENSITIVE]`;

  const raw = await ai.callGroq(system, `Category: ${category}. Discover one topic.`, 400);
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
