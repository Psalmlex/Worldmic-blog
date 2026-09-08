// ─── Internal linking ────────────────────────────────────────────────────────
// Shared by both the Affiliate Publisher and the regular Auto Publisher pipeline —
// previously this only existed inside routes/affiliate.js, meaning ordinary
// auto-published blog posts got zero internal links. Extracted here so both
// callers use one implementation instead of two copies drifting apart.
const Post = require('../models/Post');

async function buildRelatedReadingBlock(category, excludePostId) {
  const query = { status: 'published', category };
  if (excludePostId) query._id = { $ne: excludePostId };
  const related = await Post.find(query).sort({ createdAt: -1 }).limit(3).select('title slug');
  if (related.length < 2) return ''; // not worth a section for 0-1 matches
  const items = related.map(p => `<li><a href="/post/${p.slug}">${p.title}</a></li>`).join('');
  return `\n<h3>Related Reading</h3>\n<ul>${items}</ul>`;
}

module.exports = { buildRelatedReadingBlock };
