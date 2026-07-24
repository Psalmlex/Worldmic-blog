require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const connectDB = require('../config/db');
const { Settings } = require('./models/Models');

const app = express();
connectDB();

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '../public')));

// Routes
app.use('/api/auth',   require('./routes/auth'));
app.use('/api/posts',  require('./routes/posts'));
app.use('/api',        require('./routes/data'));
app.use('/api/ai',     require('./routes/ai'));
app.use('/api/upload', require('./routes/upload'));

// Seed default settings
async function seedSettings() {
  const defaults = [
    { key: 'siteName', value: 'World Mic' },
    { key: 'tagline', value: 'Voices from Every Corner of the World' },
    { key: 'footerContact', value: '+1 (555) 000-0000' },
    { key: 'footerAddress', value: '123 Media Street, Lagos, Nigeria' },
    { key: 'footerAbout', value: 'World Mic is a multi-category blog platform covering news, culture, tech, and more.' },
    { key: 'adminTone', value: 'Professional, engaging, and informative. Write with clarity and authority.' },
    { key: 'primaryColor', value: '#1a73e8' },
    { key: 'socialTwitter', value: 'https://twitter.com/worldmic' },
    { key: 'socialInstagram', value: 'https://instagram.com/worldmic' },
  ];
  for (const s of defaults) {
    await Settings.findOneAndUpdate({ key: s.key }, s, { upsert: true });
  }
}
seedSettings().catch(console.error);

// ads.txt — required by Google AdSense for site verification, generated from the configured publisher ID
app.get('/ads.txt', async (req, res) => {
  try {
    const setting = await Settings.findOne({ key: 'adsenseClientId' });
    const clientId = setting?.value?.replace('ca-pub-', '').trim();
    res.type('text/plain');
    if (!clientId) return res.send('# AdSense not configured yet');
    res.send(`google.com, pub-${clientId}, DIRECT, f08c47fec0942fa0`);
  } catch (err) {
    res.status(500).send('# error');
  }
});

// Catch-all: serve frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🌍 World Mic is running at http://localhost:${PORT}`);
  console.log(`📝 Admin panel: http://localhost:${PORT}/admin-login.html`);
  console.log(`🔑 Username: ${process.env.ADMIN_USERNAME || 'admin'}`);
  console.log(`🔑 Password: ${process.env.ADMIN_PASSWORD || 'WorldMic2025!'}\n`);
});
