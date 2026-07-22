const mongoose = require('mongoose');

// Comment Model
const commentSchema = new mongoose.Schema({
  postId: { type: mongoose.Schema.Types.ObjectId, ref: 'Post', required: true },
  name: { type: String, required: true },
  email: { type: String },
  content: { type: String, required: true },
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  aiReply: { type: String, default: '' },
  replyStatus: { type: String, enum: ['none', 'pending', 'sent'], default: 'none' },
}, { timestamps: true });

// Ad Model
const adSchema = new mongoose.Schema({
  name: { type: String, required: true },
  type: { type: String, enum: ['image', 'text', 'html'], default: 'text' },
  content: { type: String, required: true },
  imageUrl: { type: String },
  linkUrl: { type: String },
  position: { type: String, enum: ['top', 'middle', 'bottom', 'sidebar'], default: 'top' },
  isActive: { type: Boolean, default: true },
  clicks: { type: Number, default: 0 },
  impressions: { type: Number, default: 0 },
}, { timestamps: true });

// Settings Model
const settingsSchema = new mongoose.Schema({
  key: { type: String, unique: true, required: true },
  value: { type: mongoose.Schema.Types.Mixed, required: true },
  updatedBy: { type: String, default: 'admin' },
}, { timestamps: true });

// AI Log Model
const aiLogSchema = new mongoose.Schema({
  action: { type: String, required: true },
  command: { type: String },
  target: { type: String },
  result: { type: String },
  status: { type: String, enum: ['success', 'failed', 'pending_approval'], default: 'success' },
  requiresApproval: { type: Boolean, default: false },
  approved: { type: Boolean, default: false },
}, { timestamps: true });

module.exports = {
  Comment: mongoose.model('Comment', commentSchema),
  Ad: mongoose.model('Ad', adSchema),
  Settings: mongoose.model('Settings', settingsSchema),
  AILog: mongoose.model('AILog', aiLogSchema),
};
