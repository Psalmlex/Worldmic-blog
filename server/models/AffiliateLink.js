const mongoose = require('mongoose');

// One document per affiliate link inserted into a post. The generated article links
// to /go/:id (this doc's _id) instead of the raw affiliate URL directly — that
// redirect is what makes click counting possible at all; a raw outbound link can't
// be counted without it. See the public GET /go/:id route in app.js.
const affiliateLinkSchema = new mongoose.Schema({
  postId: { type: mongoose.Schema.Types.ObjectId, ref: 'Post', index: true },
  jobId: { type: mongoose.Schema.Types.ObjectId, ref: 'AffiliateJob', index: true },
  url: { type: String, required: true }, // the real destination — never shown directly in the article
  label: { type: String, default: '' }, // product name, for the analytics "Top Products" table
  network: { type: String, default: 'generic' },
  clicks: { type: Number, default: 0 },
}, { timestamps: true });

module.exports = mongoose.model('AffiliateLink', affiliateLinkSchema);
