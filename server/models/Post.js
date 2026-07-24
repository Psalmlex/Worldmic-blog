const mongoose = require('mongoose');

const postSchema = new mongoose.Schema({
  title: { type: String, required: true },
  slug: { type: String, unique: true },
  content: { type: String, required: true },
  excerpt: { type: String },
  featuredImage: { type: String, default: '' },
  category: { type: String, default: 'General' },
  tags: [String],
  author: { type: String, default: 'World Mic' },
  status: { type: String, enum: ['draft', 'published', 'archived'], default: 'draft' },
  views: { type: Number, default: 0 },
  likes: { type: Number, default: 0 },
  deletionRequested: { type: Boolean, default: false },
  deletionRequestedBy: { type: String, default: '' },
  aiGenerated: { type: Boolean, default: false },
  seoTitle: String,
  seoDescription: String,
}, { timestamps: true });

postSchema.pre('save', function(next) {
  if (!this.slug) {
    this.slug = this.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') + '-' + Date.now();
  }
  if (!this.excerpt && this.content) {
    this.excerpt = this.content.replace(/<[^>]*>/g, '').substring(0, 200) + '...';
  }
  next();
});

module.exports = mongoose.model('Post', postSchema);
