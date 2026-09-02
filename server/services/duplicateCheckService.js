const Post = require('../models/Post');
const AutoPublisherJob = require('../models/AutoPublisherJob');
const ai = require('./aiService');

function normalize(s = '') {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}

// Cheap lexical overlap check (Jaccard-ish over words) — fast, no API call, catches
// the obvious cases (same topic reworded slightly) before spending an AI call.
function wordOverlap(a, b) {
  const wa = new Set(normalize(a).split(' ').filter(w => w.length > 3));
  const wb = new Set(normalize(b).split(' ').filter(w => w.length > 3));
  if (!wa.size || !wb.size) return 0;
  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared++;
  return shared / Math.min(wa.size, wb.size);
}

function slugify(s = '') {
  return normalize(s).replace(/\s+/g, '-');
}

const LEXICAL_THRESHOLD = 0.6; // fraction of shared significant words that counts as "too similar"

// Returns { isDuplicate, reason, matchedTitle } — never throws. If the AI similarity
// pass fails, it just falls back to the lexical result rather than blocking the job.
// excludeJobId: the currently-running job's own _id must be excluded from the "recent
// jobs" comparison set — otherwise every job matches its own just-saved topic exactly
// and gets flagged as a duplicate of itself before it ever starts researching/writing.
async function checkDuplicate(topic, { periodDays = 30, excludeJobId = null } = {}) {
  const since = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000);
  const candidateSlug = slugify(topic);

  const jobQuery = { createdAt: { $gte: since } };
  if (excludeJobId) jobQuery._id = { $ne: excludeJobId };

  const [recentPosts, recentJobs] = await Promise.all([
    // Existing published posts AND drafts both count, per the spec.
    Post.find({ createdAt: { $gte: since } }).select('title slug status').limit(300),
    // Previous AI jobs (including ones that never became posts) — catches the bot
    // re-attempting a topic it already tried recently, even if that attempt failed.
    AutoPublisherJob.find(jobQuery).select('topic status').limit(300),
  ]);

  const candidates = [
    ...recentPosts.map(p => ({ title: p.title, slug: p.slug, source: `existing ${p.status} post` })),
    ...recentJobs.filter(j => j.topic).map(j => ({ title: j.topic, slug: slugify(j.topic), source: 'previous AI job' })),
  ];

  // 1) Exact/near-exact slug match — cheapest, catches literal repeats immediately.
  const slugMatch = candidates.find(c => c.slug === candidateSlug);
  if (slugMatch) {
    return { isDuplicate: true, reason: `Slug matches ${slugMatch.source}: "${slugMatch.title}"`, matchedTitle: slugMatch.title };
  }

  // 2) Lexical overlap pass across all candidates.
  let best = null;
  for (const c of candidates) {
    const score = wordOverlap(topic, c.title);
    if (!best || score > best.score) best = { score, ...c };
  }
  if (best && best.score >= LEXICAL_THRESHOLD) {
    return {
      isDuplicate: true,
      reason: `Substantially overlaps with ${best.source}: "${best.title}" (similarity ${(best.score * 100).toFixed(0)}%)`,
      matchedTitle: best.title,
    };
  }

  // 3) For borderline-similar candidates, ask the AI to make the judgment call —
  // this catches paraphrased duplicates the lexical check misses ("EV tax credits
  // changing" vs "New rules for electric vehicle incentives").
  const borderline = candidates
    .map(c => ({ ...c, score: wordOverlap(topic, c.title) }))
    .filter(c => c.score >= 0.25 && c.score < LEXICAL_THRESHOLD)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);

  if (borderline.length) {
    try {
      const system = `You check for duplicate/substantially-repetitive blog topics. Given a NEW topic and a list of EXISTING topics, say whether the new one is substantially the same subject as any existing one (same core subject, even if phrased differently) — not just "in the same general category."
Respond using EXACTLY this format, no other text:
[DUPLICATE]true or false[/DUPLICATE]
[MATCH]the existing topic it duplicates, or empty if false[/MATCH]`;
      const userMsg = `NEW TOPIC: ${topic}\n\nEXISTING TOPICS:\n${borderline.map((c, i) => `${i + 1}. ${c.title}`).join('\n')}`;
      const raw = await ai.callGroq(system, userMsg, 200);
      if (/\[DUPLICATE\]\s*true/i.test(raw)) {
        const matchLine = raw.match(/\[MATCH\]([\s\S]*?)\[\/MATCH\]/i);
        return {
          isDuplicate: true,
          reason: `AI similarity check flagged this as a duplicate of: "${matchLine?.[1]?.trim() || 'an existing topic'}"`,
          matchedTitle: matchLine?.[1]?.trim() || '',
        };
      }
    } catch (err) {
      // AI check failing isn't itself a reason to block — the lexical pass above
      // already ran and found nothing conclusive. Log and proceed.
      console.warn('[autoPublisher] AI duplicate check failed, proceeding on lexical result only:', err.message);
    }
  }

  return { isDuplicate: false, reason: '', matchedTitle: '' };
}

module.exports = { checkDuplicate };
