// ─── One-time migration: shorten existing over-long post slugs ─────────────────
// Run manually, once: `node server/scripts/shortenSlugs.js`
//
// Only touches posts whose CURRENT slug has more than MAX_SLUG_WORDS word-segments
// (excluding the trailing uniqueness timestamp) — a normal, already-short slug is
// left completely untouched. For each long slug, generates a new short one using
// the EXACT SAME algorithm as Post.js's own pre-save hook (shared via
// server/utils/slugify.js, so they can't drift apart), reusing the post's OWN
// existing timestamp suffix rather than minting a new one — that suffix is already
// guaranteed unique to this post, so reusing it guarantees the new short slug can't
// collide with any other post's slug either.
//
// The old slug is preserved in `previousSlugs` so GET /post/:slug in app.js can
// 301-redirect anyone who still has the old link — including a not-yet-indexed post
// that might already be shared somewhere this server can't see.
require('dotenv').config();
const connectDB = require('../../config/db');
const Post = require('../models/Post');
const { slugWords } = require('../utils/slugify');

const MAX_SLUG_WORDS = 8;

// A post's slug is always "<words>-<13-digit-timestamp>" (see Post.js). Splitting
// off that last hyphen-segment tells us the real word count without miscounting
// the timestamp as an extra "word".
function analyzeSlug(slug) {
  const parts = slug.split('-');
  const last = parts[parts.length - 1];
  const hasTimestamp = /^\d{10,}$/.test(last);
  const words = hasTimestamp ? parts.slice(0, -1) : parts;
  const timestamp = hasTimestamp ? last : String(Date.now());
  return { wordCount: words.length, timestamp };
}

async function run() {
  await connectDB();
  const posts = await Post.find({}).select('title slug previousSlugs');
  let changed = 0;

  for (const post of posts) {
    const { wordCount, timestamp } = analyzeSlug(post.slug);
    if (wordCount <= MAX_SLUG_WORDS) continue; // already short — leave it alone

    const newSlug = `${slugWords(post.title, MAX_SLUG_WORDS)}-${timestamp}`;
    if (newSlug === post.slug) continue; // safety net, shouldn't happen given the check above

    console.log(`Shortening:\n  old: /post/${post.slug}\n  new: /post/${newSlug}`);
    post.previousSlugs = [...(post.previousSlugs || []), post.slug];
    post.slug = newSlug;
    await post.save();
    changed++;
  }

  console.log(`\nDone — ${changed} slug(s) shortened out of ${posts.length} total post(s).`);
  process.exit(0);
}

run().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
