const mongoose = require('mongoose');

const autoPublisherJobSchema = new mongoose.Schema({
  topic: { type: String, default: '' },
  category: { type: String, default: '' },

  // Overall job lifecycle status.
  status: {
    type: String,
    enum: ['pending', 'running', 'completed', 'failed', 'skipped_duplicate'],
    default: 'pending',
  },

  // Per-stage status, so the admin can see exactly where a job is / failed.
  researchStatus: { type: String, enum: ['pending', 'running', 'done', 'failed', 'skipped'], default: 'pending' },
  articleStatus: { type: String, enum: ['pending', 'running', 'done', 'failed'], default: 'pending' },
  // Second AI pass checking the finished article's specific claims against the
  // research actually used — see aiService.verifyClaims for what this does and does
  // not guarantee. 'skipped' when the topic was evergreen and no research was used
  // AND the article had no research context to check against (rare — verifyClaims
  // still runs in that case, checking for unsupported specifics with no grounding).
  factCheckStatus: { type: String, enum: ['pending', 'running', 'done', 'failed', 'skipped'], default: 'pending' },
  flaggedClaims: [{ claim: String, reason: String }],
  imageStatus: { type: String, enum: ['pending', 'running', 'done', 'failed', 'skipped'], default: 'pending' },
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
