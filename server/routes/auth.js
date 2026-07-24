const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const auth = require('../middleware/auth');
const { StaffUser } = require('../models/Models');

router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(401).json({ error: 'Invalid credentials' });
  try {
    const envUser = process.env.ADMIN_USERNAME || 'admin';
    const envPass = process.env.ADMIN_PASSWORD || 'WorldMic2025!';

    // The single super-admin account, defined via environment variables
    if (username === envUser && password === envPass) {
      const token = jwt.sign({ username, role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '24h' });
      return res.json({ token, message: 'Login successful', role: 'admin', username });
    }

    // Additional staff accounts (created by the admin in Admin → Staff)
    const staff = await StaffUser.findOne({ username: username.toLowerCase().trim() });
    if (!staff) return res.status(401).json({ error: 'Invalid credentials' });
    const match = await bcrypt.compare(password, staff.passwordHash);
    if (!match) return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign({ username: staff.username, role: staff.role, staffId: staff._id }, process.env.JWT_SECRET, { expiresIn: '24h' });
    res.json({ token, message: 'Login successful', role: staff.role, username: staff.username });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/verify', (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ valid: false });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    res.json({ valid: true, role: decoded.role || 'admin', username: decoded.username });
  } catch {
    res.status(401).json({ valid: false });
  }
});

// ======= STAFF MANAGEMENT (admin only) =======
router.get('/staff', auth, auth.requireAdmin, async (req, res) => {
  try {
    const staff = await StaffUser.find().select('-passwordHash').sort({ createdAt: -1 });
    res.json(staff);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/staff', auth, auth.requireAdmin, async (req, res) => {
  try {
    const { username, password, role, name } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password are required' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
    const cleanUsername = username.toLowerCase().trim();
    const envUser = (process.env.ADMIN_USERNAME || 'admin').toLowerCase();
    if (cleanUsername === envUser) return res.status(400).json({ error: 'That username is reserved' });
    const existing = await StaffUser.findOne({ username: cleanUsername });
    if (existing) return res.status(400).json({ error: 'Username already taken' });
    const passwordHash = await bcrypt.hash(password, 10);
    const staff = await StaffUser.create({ username: cleanUsername, passwordHash, role: role === 'admin' ? 'admin' : 'editor', name: name || '' });
    res.status(201).json({ _id: staff._id, username: staff.username, role: staff.role, name: staff.name });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/staff/:id', auth, auth.requireAdmin, async (req, res) => {
  try {
    await StaffUser.findByIdAndDelete(req.params.id);
    res.json({ message: 'Staff account removed' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
