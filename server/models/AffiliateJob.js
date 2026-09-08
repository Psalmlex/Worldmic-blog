const mongoose = require('mongoose');

const affiliateJobSchema = new mongoose.Schema({
  mode: { type: String, enum: ['single', 'comparison', 'list'], required: true },
  inputUrls: { type: [String], default: [] }, // exactly what the admin pasted — kept for "Regenerate"

  // Snapshot of what was actually fetched/used to write the article — kept for
  // transparency (what did the AI actually see?) and so Regenerate can re-fetch
  // fresh data for the same URLs rather than needing them re-entered.
  products: [{
    name: String,
    url: String, // the real product URL
    price: String,
    currency: String,
    network: String,
    imageUrl: String, // original source image, if any was found
    imageStatus: { type: String, enum: ['uploaded', 'notified', 'skipped', 'failed'], default: 'skipped' },
    imageNotice: String, // e.g. "Amazon's terms restrict rehosting product images — add manually if you have rights to"
    extractionMethod: { type: String, enum: ['api', 'structured-data', 'meta-tags', 'title-only'], default: 'meta-tags' },
  }],

  // 'draft' = generated, awaiting review. 'completed' = admin confirmed it's done —
  // per the spec, a completed job never regenerates unless the admin explicitly
  // clicks Regenerate again. 'failed' = generation itself failed, no post created.
  status: { type: String, enum: ['running', 'draft', 'completed', 'failed'], default: 'running' },
  postId: { type: mongoose.Schema.Types.ObjectId, ref: 'Post', default: null },
  error: { type: String, default: '' },
  completedAt: { type: Date, default: null },
}, { timestamps: true });

module.exports = mongoose.model('AffiliateJob', affiliateJobSchema);
