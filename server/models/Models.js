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
  approvalStatus: { type: String, enum: ['approved', 'pending'], default: 'approved' },
  createdBy: { type: String, default: '' },
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

// Subscriber Model (Newsletter)
const subscriberSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  status: { type: String, enum: ['active', 'unsubscribed'], default: 'active' },
}, { timestamps: true });

// Staff User Model (Admin panel accounts beyond the single env-based super-admin)
const staffUserSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, lowercase: true, trim: true },
  email: { type: String, default: '' },
  passwordHash: { type: String, required: true },
  role: { type: String, enum: ['admin', 'editor'], default: 'editor' },
  name: { type: String, default: '' },
  bio: { type: String, default: '' },
  avatarUrl: { type: String, default: '' },
  emailVerified: { type: Boolean, default: true }, // true for admin-created staff; false until verified for self-signup writers
  verificationCode: { type: String, default: '' },
  verificationCodeExpires: { type: Date },
  followerCount: { type: Number, default: 0 },
}, { timestamps: true });

// Inquiry Model (Join the Team + Partner/Advertise submissions)
const inquirySchema = new mongoose.Schema({
  type: { type: String, enum: ['team', 'partner'], required: true },
  name: { type: String, required: true },
  email: { type: String, required: true },
  company: { type: String, default: '' },   // partner inquiries
  roleInterest: { type: String, default: '' }, // team applications
  message: { type: String, required: true },
  status: { type: String, enum: ['new', 'reviewed'], default: 'new' },
  inviteToken: { type: String, default: '' },
  inviteStatus: { type: String, enum: ['none', 'invited', 'signed_up'], default: 'none' },
}, { timestamps: true });

module.exports = {
  Comment: mongoose.model('Comment', commentSchema),
  Ad: mongoose.model('Ad', adSchema),
  Settings: mongoose.model('Settings', settingsSchema),
  AILog: mongoose.model('AILog', aiLogSchema),
  Subscriber: mongoose.model('Subscriber', subscriberSchema),
  StaffUser: mongoose.model('StaffUser', staffUserSchema),
  Inquiry: mongoose.model('Inquiry', inquirySchema),
};
