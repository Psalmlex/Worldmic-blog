const mongoose = require('mongoose');

// One document per affiliate link inserted into a post. The generated article links
// to /go/:id (this doc's _id) instead of the raw affiliate URL directly — that
// redirect is what makes click counting possible at all; a raw outbound link can't
// be counted without it. See the public GET /go/:id route in app.js.
const affiliateLinkSchema = new mongoose.Schema({
  postId: { type: mongoose.Schema.Types.ObjectId, ref: 'Post', index: true },
  // Deliberately no fixed `ref` here — this is created by BOTH the manual Affiliate
  // Publisher (AffiliateJob) and the autonomous Auto Publisher (AutoPublisherJob)
  // when Affiliate Mode draws from the Product Pool. `ref` only affects populate()
  // convenience, and nothing currently populates this field, so leaving it untyped
  // avoids a misleading fixed reference to just one of the two possible collections.
  jobId: { type: mongoose.Schema.Types.ObjectId, index: true },
  url: { type: String, required: true }, // the real destination — never shown directly in the article
  label: { type: String, default: '' }, // product name, for the analytics "Top Products" table
  network: { type: String, default: 'generic' },
  clicks: { type: Number, default: 0 },
}, { timestamps: true });

module.exports = mongoose.model('AffiliateLink', affiliateLinkSchema);
