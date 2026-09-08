const mongoose = require('mongoose');

const autoPublisherJobSchema = new mongoose.Schema({
  topic: { type: String, default: '' },
  category: { type: String, default: '' },
  // Which of aiService's CONTENT_TYPES voices this post was written in (blog, news,
  // review, etc.) — chosen per-topic by topic discovery, not fixed per-category, so
  // it's worth recording per job to confirm output is genuinely varying.
  contentType: { type: String, default: '' },
  // Content Strategy Engine — the specific format archetype chosen (e.g.
  // 'productReview', 'mythsVsFacts'), separate from contentType above (contentType
  // is the underlying writing voice; format is the specific structural pattern).
  // Recent formats feed back into future discovery calls for content diversity.
  format: { type: String, default: '' },
  formatLabel: { type: String, default: '' },
  // Which Product Pool items (if any) were inserted — empty unless Affiliate Mode
  // was on AND the chosen format was affiliate-suitable AND matching pool products
  // existed. Click tracking for these lives on the existing AffiliateLink records.
  affiliateProductsUsed: [{ name: String, url: String }],

  // Overall job lifecycle status.
  status: {
    type: String,
    enum: ['pending', 'running', 'completed', 'failed', 'skipped_duplicate'],
    default: 'pending',
  },

  // Per-stage status, so the admin can see exactly where a job is / failed.
  researchStatus: { type: String, enum: ['pending', 'running', 'done', 'failed', 'skipped'], default: 'pending' },
  articleStatus: { type: String, enum: ['pending', 'running', 'done', 'failed'], default: 'pending' },
  imageStatus: { type: String, enum: ['pending', 'running', 'done', 'failed', 'skipped'], default: 'pending' },
  // Inline (in-body) images are tracked separately from the featured image above —
  // a job can succeed at one and skip/fail the other independently.
  inlineImageStatus: { type: String, enum: ['pending', 'running', 'done', 'failed', 'skipped'], default: 'pending' },
  inlineImagesInserted: [{ url: String, alt: String, heading: String }],
  publishStatus: { type: String, enum: ['pending', 'draft', 'published', 'failed'], default: 'pending' },

  postId: { type: mongoose.Schema.Types.ObjectId, ref: 'Post', default: null },

  // What research was actually used, for transparency/audit.
  researchSources: [{ title: String, link: String, snippet: String }],
  searchProviderUsed: { type: String, default: '' },

  error: { type: String, default: '' },
  retryCount: { type: Number, default: 0 },
  maxRetries: { type: Number, default: 2 },

  // Was this a manual "Run Now" or a scheduled slot firing?
  trigger: { type: String, enum: ['scheduled', 'manual'], default: 'scheduled' },

  startedAt: { type: Date, default: null },
  completedAt: { type: Date, default: null },
}, { timestamps: true }); // createdAt = "Created time" from the spec

autoPublisherJobSchema.index({ createdAt: -1 });
autoPublisherJobSchema.index({ status: 1 });

module.exports = mongoose.model('AutoPublisherJob', autoPublisherJobSchema);
