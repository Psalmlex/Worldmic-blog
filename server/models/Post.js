const mongoose = require('mongoose');
const { slugWords } = require('../utils/slugify');

const postSchema = new mongoose.Schema({
  title: { type: String, required: true },
  slug: { type: String, unique: true },
  // Old slug(s) this post has answered to — populated by the one-time slug-shortening
  // migration (server/scripts/shortenSlugs.js). Lets an already-shared or already-
  // indexed old URL keep working via a 301 redirect (see GET /post/:slug in app.js)
  // instead of silently breaking when a slug changes.
  previousSlugs: { type: [String], default: [] },
  content: { type: String, required: true },
  excerpt: { type: String },
  featuredImage: { type: String, default: '' },
  category: { type: String, default: 'General' },
  tags: [String],
  author: { type: String, default: 'World Mic' },
  status: { type: String, enum: ['draft', 'published', 'archived'], default: 'draft' },
  views: { type: Number, default: 0 },
  likes: { type: Number, default: 0 },
  authorUsername: { type: String, default: '' },
  deletionRequested: { type: Boolean, default: false },
  deletionRequestedBy: { type: String, default: '' },
  aiGenerated: { type: Boolean, default: false },
  seoTitle: String,
  seoDescription: String,
  notifSeen: { type: Boolean, default: false }, // has the admin already seen/dismissed the "new post" notification for this?
}, { timestamps: true });

postSchema.pre('save', function(next) {
  if (!this.slug) {
    // Cap the slug to the first several words instead of the whole (sometimes
    // run-on) title — a slug like "5-gadgets-that-will-change-your-work-from-
    // home-experience-in-2026-as-remote-work-continues-to-evolve-people-are-
    // looking-for..." is unreadable, looks spammy/keyword-stuffed to search
    // engines, and can get truncated oddly in shared links and search results.
    // Hyphen-separated words are still correct and Google-recommended — only the
    // LENGTH was ever the real problem. Same cleanup as before, just bounded.
    this.slug = slugWords(this.title) + '-' + Date.now();
  }
  if (!this.excerpt && this.content) {
    this.excerpt = this.content.replace(/<[^>]*>/g, '').substring(0, 200) + '...';
  }
  next();
});

module.exports = mongoose.model('Post', postSchema);
