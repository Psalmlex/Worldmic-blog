const mongoose = require('mongoose');

// A small, admin-maintained pool of REAL affiliate links, added once via the
// Affiliate Publisher's existing fetch pipeline. The Auto Publisher draws from this
// pool automatically when Affiliate Mode is on and a topic's chosen format calls for
// a product (see autoPublisherEngine.js) — it never invents or searches for random
// product URLs on its own, since a discovered URL wouldn't carry your affiliate
// tracking ID and would earn nothing. This is what makes automated affiliate
// insertion honestly correct rather than a guess.
const affiliateProductSchema = new mongoose.Schema({
  url: { type: String, required: true }, // the admin's own real affiliate link
  name: { type: String, default: '' },
  price: { type: String, default: '' },
  currency: { type: String, default: '' },
  network: { type: String, default: 'generic' },
  imageUrl: { type: String, default: '' },
  imageCloudinaryUrl: { type: String, default: '' },
  imageStatus: { type: String, enum: ['uploaded', 'notified', 'skipped', 'failed'], default: 'skipped' },
  imageNotice: { type: String, default: '' },
  category: { type: String, default: 'General' }, // matched against the Auto Publisher's chosen post category
  active: { type: Boolean, default: true }, // admin can retire a product without deleting its click history
  lastUsedAt: { type: Date, default: null }, // drives least-recently-used rotation across auto-published posts
}, { timestamps: true });

module.exports = mongoose.model('AffiliateProduct', affiliateProductSchema);
