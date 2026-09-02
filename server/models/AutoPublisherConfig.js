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

  wordCount: { type: String, enum: ['short', 'medium', 'long'], default: 'medium' },
  minResearchSources: { type: Number, default: 3, min: 1, max: 10 },
  imageGenerationEnabled: { type: Boolean, default: true },

  // How far back (days) to look when checking for duplicate/near-duplicate topics.
  duplicateCheckPeriodDays: { type: Number, default: 30, min: 1 },

  // 'serper' uses the existing configured Serper key via aiService.webSearch.
  // 'browser' uses the Puppeteer-based Google-search fallback (see searchService.js) —
  // only relevant when no Serper key is configured.
  searchProvider: { type: String, enum: ['auto', 'serper', 'browser'], default: 'auto' },

  // Runtime/scheduling bookkeeping — not admin-editable directly.
  paused: { type: Boolean, default: false },
  lastRunAt: { type: Date, default: null },
  nextRunAt: { type: Date, default: null },
  // Prevents double-firing the same scheduled slot (e.g. after a restart within the
  // same minute). Format: 'YYYY-MM-DD HH:mm' in the configured timezone.
  lastFiredSlotKey: { type: String, default: '' },
}, { timestamps: true });

module.exports = mongoose.model('AutoPublisherConfig', autoPublisherConfigSchema);
