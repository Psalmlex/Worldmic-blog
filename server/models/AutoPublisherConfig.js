const mongoose = require('mongoose');

// Singleton config document (there is only ever one — enforced by the service layer,
// which always upserts against { singleton: true } rather than creating new docs).
const autoPublisherConfigSchema = new mongoose.Schema({
  singleton: { type: Boolean, default: true, unique: true },

  enabled: { type: Boolean, default: false },
  mode: { type: String, enum: ['draft', 'autopublish'], default: 'draft' }, // Auto-Publish must be OFF (draft) by default

  // Full IANA timezone, e.g. 'Africa/Lagos', 'America/New_York'. Not restricted to any region.
  timezone: { type: String, default: 'Africa/Lagos' },

  // Times of day (24h "HH:mm", in the configured timezone) the bot should try to run.
  // Length of this array is effectively "posts per day", but stored explicitly so an
  // admin can pick which times, not just a count.
  publishTimes: { type: [String], default: ['09:00'] },
  postsPerDay: { type: Number, default: 1, min: 1, max: 24 },

  // Configurable categories to draw topics from — never hard-coded.
  categories: { type: [String], default: [] },
  // Pulls real "People Also Ask" / related-search questions from a live Google SERP
  // (via Serper) to ground topic discovery in genuine search demand instead of an AI
  // guess — this is what lets the bot post "how to X" articles people are actually
  // searching for. Uses one extra Serper call per job when on; costs nothing extra
  // and degrades to pure AI discovery automatically if Serper isn't configured.
  useRealSearchQuestions: { type: Boolean, default: true },

  wordCount: { type: String, enum: ['short', 'medium', 'long'], default: 'medium' },
  minResearchSources: { type: Number, default: 3, min: 1, max: 10 },
  imageGenerationEnabled: { type: Boolean, default: true },
  // Separate from the featured-image toggle above — controls whether the article
  // body may also get 0-2 inline images where a section is genuinely visual. Kept
  // as its own switch since an admin may want a featured image but not extra
  // per-article image-generation cost/time from inline ones, or vice versa.
  inlineImagesEnabled: { type: Boolean, default: true },

  // How far back (days) to look when checking for duplicate/near-duplicate topics.
  duplicateCheckPeriodDays: { type: Number, default: 30, min: 1 },

  // 'google' uses the Google Custom Search API (GOOGLE_SEARCH_API_KEY/
  // GOOGLE_SEARCH_ENGINE_ID env vars — see aiService.googleSearch). 'serper' uses the
  // existing configured Serper key via aiService.webSearch. 'browser' uses the
  // Puppeteer-based Google-search fallback (see searchService.js) — only reached in
  // 'auto' mode when neither Google nor Serper is configured/working.
  searchProvider: { type: String, enum: ['auto', 'google', 'serper', 'browser'], default: 'auto' },

  // Runtime/scheduling bookkeeping — not admin-editable directly.
  paused: { type: Boolean, default: false },
  lastRunAt: { type: Date, default: null },
  nextRunAt: { type: Date, default: null },
  // Prevents double-firing the same scheduled slot (e.g. after a restart within the
  // same minute). Format: 'YYYY-MM-DD HH:mm' in the configured timezone.
  lastFiredSlotKey: { type: String, default: '' },
}, { timestamps: true });

module.exports = mongoose.model('AutoPublisherConfig', autoPublisherConfigSchema);
