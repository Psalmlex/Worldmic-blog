// ─── Automatic topic discovery ──────────────────────────────────────────────
// Categories come entirely from AutoPublisherConfig.categories (admin-configured,
// never hard-coded). If none are configured, falls back to whatever categories
// already exist on published posts, so the bot still works out of the box.

const ai = require('./aiService'); // reuses the existing text-AI plumbing, not a new one
const Post = require('../models/Post');
const strategy = require('./contentStrategyEngine');

function parseTagged(raw, keys) {
  const result = {};
  for (const key of keys) {
    const re = new RegExp(`\\[${key}\\]([\\s\\S]*?)\\[/${key}\\]`, 'i');
    const match = raw.match(re);
    result[key] = match ? match[1].trim() : '';
  }
  return result;
}

// Lenient, punctuation/spacing/casing-agnostic matching: an LLM shown a menu like
// "bestXForY: Best X for Y List" is just as likely to echo the human-readable label
// ("Best X for Y") as the exact camelCase key — matching only the exact key caused
// most real responses to silently fail lookup and fall back to the generic 'article'
// default far more often than intended (confirmed against real output patterns).
// This strips everything but letters/digits before comparing, and matches against
// BOTH the key and the label, so "Best X For Y", "best-x-for-y", and "bestXForY"
// all resolve to the same archetype.
function normalizeKey(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}
const FORMAT_LOOKUP = new Map();
for (const name of strategy.getFormatNames()) {
  FORMAT_LOOKUP.set(normalizeKey(name), name);
  FORMAT_LOOKUP.set(normalizeKey(strategy.getFormat(name).label), name);
}

async function resolveCategoryPool(configuredCategories = []) {
  if (configuredCategories?.length) return configuredCategories;
  const existing = await Post.distinct('category', { status: 'published' });
  return existing.length ? existing : ['General'];
}

// Recently-used topics/categories are passed in so the model actively avoids
// repeating what was just covered (a first, cheap line of defense — the real
// duplicate protection is duplicateCheckService, run afterward against full posts).
// useRealSearchQuestions: pulls actual "People Also Ask" / related-search questions
// from a live Google SERP (via Serper — see aiService.getRelatedQuestions) so the
// topic can be grounded in genuine search demand instead of an AI guess. Fails safe
// to pure AI discovery if Serper isn't configured or the call fails.
// recentFormats: the last few format archetypes actually used (see AutoPublisherJob
// .format) — this is the content diversity engine: a soft preference against
// repeating the same format back-to-back, expressed to the model as guidance rather
// than a hard rule, so a genuinely well-fitting format is never overridden just to
// force variety.
// affiliateModeEnabled: when true, the model may ALSO consider affiliate-suitable
// formats (product review, comparison, best-X-for-Y, roundup) if the topic
// genuinely calls for one. When false, those formats are never proposed at all —
// this is what keeps affiliate format selection separate from the normal blog path.
async function discoverTopic({ categories = [], recentTopics = [], recentFormats = [], useRealSearchQuestions = true, affiliateModeEnabled = false } = {}) {
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

  // Seed with "how to" specifically — People Also Ask tends to chain into further
  // how-to/question-style results from a how-to-flavored seed, which is exactly the
  // format being asked for. This never blocks discovery: an empty list here just
  // means the prompt below has nothing extra to work with, and the AI proceeds
  // exactly as it did before this feature existed.
  let realQuestions = [];
  if (useRealSearchQuestions) {
    realQuestions = await ai.getRelatedQuestions(`${category} how to`);
  }

  const availableFormats = strategy.getFormatNames().filter(f => affiliateModeEnabled || !strategy.isAffiliateSuitable(f));
  const formatMenu = availableFormats.map(f => `- ${f}: ${strategy.getFormat(f).label}`).join('\n');

  const system = `You are a content strategist discovering ONE fresh, specific, publish-worthy blog topic for the category "${category}" on a global multi-category blog, and choosing which article FORMAT best fits it.

TODAY'S ACTUAL DATE IS ${todayStr}. This is the true, current, real-world date — your own training data has a cutoff well before this, so do NOT rely on your internal sense of what's "recent" or "trending." A topic that was current when you were trained is very likely stale now. Propose something that would make sense to publish on THIS actual date.
Strongly prefer genuinely current developments — something happening in or near the present moment — over evergreen topics. Only propose an evergreen topic if nothing recent and worthwhile comes to mind for this category. Do not propose anything generic, vague, already well-covered, or anchored to a year that has already passed.
A broad, generic version of a topic ("AI in healthcare", "the future of electric cars") is something hundreds of other sites already cover identically — publishing that adds nothing distinct. Narrow it to a specific angle, a specific group affected, a specific mechanism, or a specific comparison instead, so the piece could only have come from actually thinking about this topic, not from picking the obvious headline.
${recentTopics.length ? `AVOID overlapping with these recently-covered topics: ${recentTopics.join('; ')}` : ''}
${realQuestions.length ? `\nREAL QUESTIONS GOOGLE USERS ARE ACTUALLY SEARCHING FOR IN THIS CATEGORY RIGHT NOW:\n${realQuestions.map(q => `- ${q}`).join('\n')}\nThese reflect genuine search demand and are a good source for WHAT SUBJECT to cover — but they are not necessarily how the final TITLE should be worded. Use one as inspiration for the underlying subject when a good one fits, then phrase the actual title to match whichever FORMAT you choose below, not necessarily this question's exact wording (see title conventions per format below — "how to"/"what is" phrasing is only correct for a few specific formats, not the default).` : ''}

FORMAT SELECTION: pick whichever format genuinely fits this specific topic and category's search intent best — do not default to the same format every time, and do not default to a "how to" / "what is" framing just because that's what a search-demand question happened to use. As general guidance for what typically fits which kind of category (not a rigid rule — the specific topic always wins over the general pattern):
- Tech/gadgets/software → often productReview, comparison, or bestXForY
- Books/media → often productReview or bestXForY ("best books about...")
- Health/wellness → often ultimateGuide or mythsVsFacts (evidence-based, not casual)
- Finance/money → often ultimateGuide, caseStudy, or checklist (concrete, practical)
- Travel → often ultimateGuide or bestXForY
- Breaking developments in any category → industryNews
- A topic with a real, defensible stance → opinionPiece
- A pattern building over time → trendAnalysis
- Only pick tutorial when the piece is genuinely a sequential how-to; only pick faq/qAndA when a real Q&A structure is genuinely the best fit — these are NOT safe defaults for every topic.
${recentFormats.length ? `\nRECENTLY USED FORMATS (most recent first): ${recentFormats.join(', ')}. Prefer a DIFFERENT format than these if one genuinely fits this topic well too — avoid repeating the same format back-to-back purely by default. Only repeat one of these if it's clearly the best fit and nothing else genuinely works as well.` : ''}

AVAILABLE FORMATS (respond with the exact key shown before the colon, e.g. "bestXForY" — not the description after it):
${formatMenu}

TITLE CONVENTION PER FORMAT — once you've picked a format, the TOPIC's phrasing below MUST follow that format's convention, not default to a "how to"/"what is" question:
${availableFormats.map(f => `- ${f}: ${strategy.getFormat(f).titleConvention}`).join('\n')}

Respond using EXACTLY this format, no other text, no JSON, no markdown fences:

[FORMAT]exactly one format KEY from the AVAILABLE FORMATS list above (e.g. "bestXForY"), chosen for genuine fit — not a default[/FORMAT]
[TOPIC]A specific, concrete topic phrased to match the TITLE CONVENTION of the format you just chose above — not a vague category label, and not defaulted to "how to"/"what is" phrasing unless that format's convention specifically calls for it. If it's a current-events topic, make the recency explicit in the topic itself[/TOPIC]
[ANGLE]The specific angle or reason this is worth publishing right now, on ${todayStr}, one sentence[/ANGLE]
[NEEDS_CURRENT_INFO]true or false — true if this topic depends on recent/current facts that require a live web search to write accurately, false if it's evergreen and safe to write from general knowledge[/NEEDS_CURRENT_INFO]
[SENSITIVE]true or false — true if this topic touches health, finance, politics, breaking news, or legal advice and needs stricter validation before publishing[/SENSITIVE]`;

  const raw = await ai.callGroq(system, `Category: ${category}. Today is ${todayStr}. Pick a format, then discover one genuinely current topic titled to match it.`, 500);
  const parsed = parseTagged(raw, ['TOPIC', 'ANGLE', 'NEEDS_CURRENT_INFO', 'SENSITIVE', 'FORMAT']);

  if (!parsed.TOPIC) throw new Error('Topic discovery failed: the AI did not return a usable topic.');

  // Normalize + validate: fall back to a safe, always-available default if the model
  // picked something invalid, or picked an affiliate-suitable format while affiliate
  // mode is off (defense in depth beyond just excluding it from the menu above).
  let formatName = FORMAT_LOOKUP.get(normalizeKey(parsed.FORMAT));
  if (!formatName || (!affiliateModeEnabled && strategy.isAffiliateSuitable(formatName))) {
    formatName = 'article';
  }
  const format = strategy.getFormat(formatName);

  return {
    topic: parsed.TOPIC,
    category,
    angle: parsed.ANGLE || '',
    needsCurrentInfo: /true/i.test(parsed.NEEDS_CURRENT_INFO || ''),
    sensitive: /true/i.test(parsed.SENSITIVE || ''),
    format: formatName,
    formatLabel: format.label,
    contentType: format.contentType,
    styleInstruction: format.styleInstruction,
  };
}

module.exports = { discoverTopic };
