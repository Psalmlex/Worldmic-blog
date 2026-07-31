/* ===================================
   WORLD MIC - MAIN JS
   =================================== */

const API = '/api';

// ===== DARK MODE =====
const SUN_ICON = '<svg viewBox="0 0 24 24"><path d="M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10zm0-5a1 1 0 0 1 1 1v1a1 1 0 1 1-2 0V3a1 1 0 0 1 1-1zm0 18a1 1 0 0 1 1 1v1a1 1 0 1 1-2 0v-1a1 1 0 0 1 1-1zM4.22 4.22a1 1 0 0 1 1.41 0l.71.71a1 1 0 1 1-1.41 1.41l-.71-.71a1 1 0 0 1 0-1.41zm14.14 14.14a1 1 0 0 1 1.41 0l.71.71a1 1 0 1 1-1.41 1.41l-.71-.71a1 1 0 0 1 0-1.41zM1 12a1 1 0 0 1 1-1h1a1 1 0 1 1 0 2H2a1 1 0 0 1-1-1zm18 0a1 1 0 0 1 1-1h1a1 1 0 1 1 0 2h-1a1 1 0 0 1-1-1zM4.22 19.78a1 1 0 0 1 0-1.41l.71-.71a1 1 0 1 1 1.41 1.41l-.71.71a1 1 0 0 1-1.41 0zM18.36 5.64a1 1 0 0 1 0-1.41l.71-.71a1 1 0 1 1 1.41 1.41l-.71.71a1 1 0 0 1-1.41 0z"/></svg>';
const MOON_ICON = '<svg viewBox="0 0 24 24"><path d="M12.1 22c-5.5 0-10-4.5-10-10 0-4.8 3.4-8.9 8-9.8.4-.1.8.1 1 .5.2.4.1.8-.2 1.1-1.8 1.7-2.8 4-2.8 6.5 0 5 4 9 9 9 .5 0 1-.1 1.5-.1.4-.1.8.1 1 .5.2.4 0 .8-.3 1.1-1.9 1.4-4.2 2.2-6.6 2.2-.2 0-.4 0-.6 0z"/></svg>';

(function initTheme() {
  const saved = localStorage.getItem('wm_theme') || 'light';
  document.documentElement.setAttribute('data-theme', saved);
})();

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'light';
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('wm_theme', next);
  const btn = document.getElementById('themeToggleBtn');
  if (btn) btn.innerHTML = next === 'dark' ? SUN_ICON : MOON_ICON;
}

// ===== API HELPERS =====
async function apiFetch(path, options = {}) {
  const token = localStorage.getItem('wm_token');
  const headers = { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers };
  const res = await fetch(API + path, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

// ===== SETTINGS =====
let _settings = null;
async function getSettings() {
  if (_settings) return _settings;
  try { _settings = await apiFetch('/settings'); return _settings; } catch { return {}; }
}

// ===== TOAST =====
function showToast(message, type = 'info', duration = 3500) {
  let container = document.querySelector('.toast-container');
  if (!container) { container = document.createElement('div'); container.className = 'toast-container'; document.body.appendChild(container); }
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  const icons = { success: '✓', error: '✕', info: 'ℹ' };
  toast.innerHTML = `<span>${icons[type] || 'ℹ'}</span> ${message}`;
  container.appendChild(toast);
  setTimeout(() => { toast.style.animation = 'slideIn 0.3s ease reverse'; setTimeout(() => toast.remove(), 300); }, duration);
}

// ===== FORMAT DATE =====
function formatDate(date, full = false) {
  const d = new Date(date);
  if (full) return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ===== READING TIME =====
function readingTime(content) {
  const words = content?.replace(/<[^>]*>/g, '').split(/\s+/).length || 0;
  return Math.max(1, Math.round(words / 200));
}

// ===== RENDER AD =====
async function renderAds(containerId, position) {
  const container = document.getElementById(containerId);
  if (!container) return;
  try {
    const ads = await apiFetch(`/ads?position=${position}`);
    if (!ads.length) { container.style.display = 'none'; return; }
    container.innerHTML = ads.map(ad => `
      <div class="ad-block">
        <div class="ad-inner" onclick="trackAdClick('${ad._id}', '${ad.linkUrl || '#'}')">
          ${ad.type === 'image' && ad.imageUrl ? `<img src="${ad.imageUrl}" alt="${ad.name}" loading="lazy" />` : `<div class="ad-text-content">${ad.content}</div>`}
        </div>
      </div>`).join('');
  } catch { container.style.display = 'none'; }
}

function trackAdClick(adId, url) {
  fetch(`${API}/ads/${adId}/click`, { method: 'POST' }).catch(() => {});
  if (url && url !== '#') window.open(url, '_blank', 'noopener');
}

// ===== RENDER FOOTER =====
async function renderFooter() {
  const footer = document.getElementById('site-footer');
  if (!footer) return;
  const s = await getSettings();
  footer.innerHTML = `
    <div class="footer-top">
      <div class="footer-brand">
        <div class="site-logo"><div class="logo-icon"><svg viewBox="0 0 24 24"><ellipse cx="12" cy="12" rx="11" ry="5.2" style="fill:none;stroke:#fff;stroke-width:1.4;opacity:0.55"/><rect x="9" y="2.5" width="6" height="11" rx="3"/><path d="M6.5 11 Q6.5 17.5 12 17.5 Q17.5 17.5 17.5 11" style="fill:none;stroke:#fff;stroke-width:1.8;stroke-linecap:round"/><line x1="12" y1="17.5" x2="12" y2="21" style="stroke:#fff;stroke-width:1.8;stroke-linecap:round"/><line x1="8.5" y1="21" x2="15.5" y2="21" style="stroke:#fff;stroke-width:1.8;stroke-linecap:round"/></svg></div><div class="logo-text">World<span>Mic</span></div></div>
        <p class="footer-desc">${s.footerAbout || 'World Mic is a multi-category blog platform.'}</p>
        <div class="footer-social">
          <a href="${s.socialTwitter || '#'}" class="social-link" target="_blank" rel="noopener"><svg viewBox="0 0 24 24"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.744l7.735-8.851L1.254 2.25H8.08l4.259 5.63L18.244 2.25zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77z"/></svg></a>
          <a href="${s.socialInstagram || '#'}" class="social-link" target="_blank" rel="noopener"><svg viewBox="0 0 24 24"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/></svg></a>
        </div>
      </div>
      <div>
        <h3 class="footer-heading">Quick Links</h3>
        <ul class="footer-links">
          <li><a href="/">Home</a></li>
          <li><a href="/category.html">Categories</a></li>
          <li><a href="/search.html">Search</a></li>
          <li><a href="/about.html">About Us</a></li>
          <li><a href="/join-team.html">Join Our Team</a></li>
          <li><a href="/partner.html">Partner / Advertise</a></li>
        </ul>
      </div>
      <div>
        <h3 class="footer-heading">Contact</h3>
        <div class="footer-contact-item"><svg viewBox="0 0 24 24"><path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z"/></svg><span>${s.footerContact || 'Contact number'}</span></div>
        <div class="footer-contact-item"><svg viewBox="0 0 24 24"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg><span>${s.footerAddress || 'Address'}</span></div>
      </div>
      <div>
        <h3 class="footer-heading">Newsletter</h3>
        <p style="font-size:0.85rem;opacity:0.65;margin-bottom:14px;line-height:1.6">Get the latest posts delivered to your inbox.</p>
        <form class="newsletter-form" id="newsletterForm">
          <input type="email" class="newsletter-input" id="newsletterEmail" placeholder="you@email.com" required />
          <button type="submit" class="btn btn-primary btn-sm">Join</button>
        </form>
      </div>
    </div>
    <div class="footer-bottom"><p>© ${new Date().getFullYear()} ${s.siteName || 'World Mic'}. All rights reserved.</p></div>`;
  document.getElementById('newsletterForm')?.addEventListener('submit', subscribeNewsletter);
}

async function subscribeNewsletter(e) {
  e.preventDefault();
  const input = document.getElementById('newsletterEmail');
  const email = input.value.trim();
  if (!email) return;
  const btn = e.target.querySelector('button');
  const originalText = btn.textContent;
  btn.disabled = true; btn.textContent = '...';
  try {
    const data = await apiFetch('/subscribe', { method: 'POST', body: JSON.stringify({ email }) });
    showToast(data.message || 'Subscribed!', 'success');
    input.value = '';
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    btn.disabled = false; btn.textContent = originalText;
  }
}

// ===== RENDER HEADER =====
async function renderHeader(activePage = '') {
  const header = document.getElementById('site-header');
  if (!header) return;
  const s = await getSettings();
  header.innerHTML = `
    <div class="header-inner">
      <a href="/" class="site-logo"><div class="logo-icon"><svg viewBox="0 0 24 24"><ellipse cx="12" cy="12" rx="11" ry="5.2" style="fill:none;stroke:#fff;stroke-width:1.4;opacity:0.55"/><rect x="9" y="2.5" width="6" height="11" rx="3"/><path d="M6.5 11 Q6.5 17.5 12 17.5 Q17.5 17.5 17.5 11" style="fill:none;stroke:#fff;stroke-width:1.8;stroke-linecap:round"/><line x1="12" y1="17.5" x2="12" y2="21" style="stroke:#fff;stroke-width:1.8;stroke-linecap:round"/><line x1="8.5" y1="21" x2="15.5" y2="21" style="stroke:#fff;stroke-width:1.8;stroke-linecap:round"/></svg></div><div class="logo-text">World<span>Mic</span></div></a>
      <nav class="main-nav" id="mainNav">
        <a href="/" class="${activePage === 'home' ? 'active' : ''}">Home</a>
        <a href="/category.html" class="${activePage === 'categories' ? 'active' : ''}">Categories</a>
        <a href="/search.html" class="${activePage === 'search' ? 'active' : ''}">Search</a>
      </nav>
      <div class="header-search"><input type="text" class="search-input" placeholder="Search posts..." id="headerSearch" /><button class="btn btn-primary btn-sm" onclick="doSearch()">Search</button></div>
      <button class="theme-toggle" id="themeToggleBtn" onclick="toggleTheme()" title="Toggle dark mode"></button>
      <div class="hamburger" onclick="toggleMobileMenu()"><span></span><span></span><span></span></div>
    </div>
    <div class="mobile-menu" id="mobileMenu">
      <a href="/">Home</a><a href="/category.html">Categories</a><a href="/search.html">Search</a>
    </div>`;
  document.getElementById('headerSearch')?.addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });
  const themeBtn = document.getElementById('themeToggleBtn');
  if (themeBtn) themeBtn.innerHTML = document.documentElement.getAttribute('data-theme') === 'dark' ? SUN_ICON : MOON_ICON;
}

function doSearch() {
  const q = document.getElementById('headerSearch')?.value.trim();
  if (q) window.location.href = `/search.html?q=${encodeURIComponent(q)}`;
}

function toggleMobileMenu() {
  document.getElementById('mobileMenu')?.classList.toggle('open');
}

// ===== LOADING SKELETON =====
function renderSkeletons(container, count = 3) {
  container.innerHTML = Array(count).fill(`
    <div class="post-card">
      <div class="post-card-img skeleton" style="height:180px"></div>
      <div class="card-body">
        <div class="skeleton" style="height:14px;width:60px;margin-bottom:10px;border-radius:4px"></div>
        <div class="skeleton" style="height:20px;margin-bottom:8px;border-radius:4px"></div>
        <div class="skeleton" style="height:16px;width:80%;border-radius:4px"></div>
      </div>
    </div>`).join('');
}

// ===== POST CARD =====
function postCardHTML(post) {
  return `
    <div class="post-card">
      <div class="post-card-img">
        ${post.featuredImage ? `<img src="${post.featuredImage}" alt="${post.title}" loading="lazy" />` : `<div class="no-img"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/></svg></div>`}
      </div>
      <div class="card-body">
        <div class="card-category">${post.category || 'General'}</div>
        <h3 class="card-title"><a href="/post.html?id=${post._id}">${post.title}</a></h3>
        <p class="card-excerpt">${post.excerpt || ''}</p>
      </div>
      <div class="card-footer">
        <div class="card-meta">
          <span><svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z"/></svg>${formatDate(post.createdAt)}</span>
          <span>${readingTime(post.content)} min read</span>
        </div>
        <a href="/post.html?id=${post._id}" class="btn btn-sm btn-secondary">Read →</a>
      </div>
    </div>`;
}

// ===== ADSENSE =====
let _adsenseScriptLoaded = false;

// ===== GOOGLE ANALYTICS =====
let _gaScriptLoaded = false;

async function initGoogleAnalytics() {
  const s = await getSettings();
  const gaId = s.gaId;
  if (!gaId || _gaScriptLoaded) return;

  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${gaId}`;
  document.head.appendChild(script);

  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }
  window.gtag = gtag;
  gtag('js', new Date());
  gtag('config', gaId);
  _gaScriptLoaded = true;
}

async function initAdSense() {
  const s = await getSettings();
  const clientId = s.adsenseClientId;
  if (!clientId) return; // not configured — do nothing

  if (!_adsenseScriptLoaded) {
    const script = document.createElement('script');
    script.async = true;
    script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${clientId}`;
    script.crossOrigin = 'anonymous';
    document.head.appendChild(script);
    _adsenseScriptLoaded = true;
  }

  if (s.adsenseHeaderEnabled === 'true' && s.adsenseSlotTop) {
    renderAdSlot('adSlotTop', clientId, s.adsenseSlotTop);
  }
  if (s.adsenseContentEnabled === 'true' && s.adsenseSlotContent) {
    document.querySelectorAll('[data-ad-slot="content"]').forEach((el, i) => {
      renderAdSlot(el.id || (el.id = `adSlotContent${i}`), clientId, s.adsenseSlotContent);
    });
  }
}

function renderAdSlot(containerId, clientId, slotId) {
  const container = document.getElementById(containerId);
  if (!container || container.dataset.rendered) return;
  container.dataset.rendered = '1';
  container.innerHTML = `
    <div class="ad-label">Advertisement</div>
    <ins class="adsbygoogle" style="display:block" data-ad-client="${clientId}" data-ad-slot="${slotId}" data-ad-format="auto" data-full-width-responsive="true"></ins>`;
  try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch {}
}

// Init on every page
document.addEventListener('DOMContentLoaded', async () => {
  await renderHeader();
  await renderFooter();
  initAdSense();
  initGoogleAnalytics();
});
