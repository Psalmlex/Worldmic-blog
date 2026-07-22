/* ===================================
   WORLD MIC - ADMIN SHARED JS
   =================================== */

const TOKEN = () => localStorage.getItem('wm_token');

// Auth guard - redirect to login if not authenticated
async function requireAuth() {
  const token = TOKEN();
  if (!token) { location.href = '/admin-login.html'; return false; }
  try {
    const res = await fetch('/api/auth/verify', { headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json();
    if (!data.valid) { localStorage.removeItem('wm_token');
localStorage.removeItem('wm_admin');
location.href = '/admin-login.html'; return false; }
    return true;
  } catch { location.href = '/admin-login.html'; return false; }
}

function logout() {
  localStorage.removeItem('wm_token');
  localStorage.removeItem('wm_admin');
  location.href = '/admin-login.html';
}

// Admin API helper
async function adminFetch(path, options = {}) {
  const res = await fetch('/api' + path, {
    ...options,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN()}`, ...options.headers }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

// Toast
function showToast(message, type = 'info', duration = 3500) {
  let c = document.querySelector('.toast-container');
  if (!c) { c = document.createElement('div'); c.className = 'toast-container'; document.body.appendChild(c); }
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = message;
  c.appendChild(t);
  setTimeout(() => { t.style.animation = 'slideIn 0.3s ease reverse'; setTimeout(() => t.remove(), 300); }, duration);
}

// Format date
function fmtDate(d, full = false) {
  const dt = new Date(d);
  return full ? dt.toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' })
              : dt.toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' });
}

// Confirm dialog
function confirmAction(msg) { return confirm(msg); }

// Inject admin sidebar
function renderAdminLayout(activeLink = '') {
  const nav = [
    { href: '/admin-dashboard.html', icon: 'M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z', label: 'Dashboard' },
    { href: '/admin-posts.html', icon: 'M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z', label: 'Posts' },
    { href: '/admin-create.html', icon: 'M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z', label: 'New Post' },
    { href: '/admin-comments.html', icon: 'M21 6.5c0-1.38-1.12-2.5-2.5-2.5h-15C2.12 4 1 5.12 1 6.5v11C1 18.88 2.12 20 3.5 20H19l4 4V6.5z', label: 'Comments' },
    { href: '/admin-ads.html', icon: 'M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5', label: 'Ads' },
    { href: '/admin-settings.html', icon: 'M19.14,12.94c0.04-0.3,0.06-0.61,0.06-0.94c0-0.32-0.02-0.64-0.07-0.94l2.03-1.58c0.18-0.14,0.23-0.41,0.12-0.61 l-1.92-3.32c-0.12-0.22-0.37-0.29-0.59-0.22l-2.39,0.96c-0.5-0.38-1.03-0.7-1.62-0.94L14.4,2.81c-0.04-0.24-0.24-0.41-0.48-0.41 h-3.84c-0.24,0-0.43,0.17-0.47,0.41L9.25,5.35C8.66,5.59,8.12,5.92,7.63,6.29L5.24,5.33c-0.22-0.08-0.47,0-0.59,0.22L2.74,8.87 C2.62,9.08,2.66,9.34,2.86,9.48l2.03,1.58C4.84,11.36,4.8,11.69,4.8,12s0.02,0.64,0.07,0.94l-2.03,1.58 c-0.18,0.14-0.23,0.41-0.12,0.61l1.92,3.32c0.12,0.22,0.37,0.29,0.59,0.22l2.39-0.96c0.5,0.38,1.03,0.7,1.62,0.94l0.36,2.54 c0.05,0.24,0.24,0.41,0.48,0.41h3.84c0.24,0,0.44-0.17,0.47-0.41l0.36-2.54c0.59-0.24,1.13-0.56,1.62-0.94l2.39,0.96 c0.22,0.08,0.47,0,0.59-0.22l1.92-3.32c0.12-0.22,0.07-0.47-0.12-0.61L19.14,12.94z M12,15.6c-1.98,0-3.6-1.62-3.6-3.6 s1.62-3.6,3.6-3.6s3.6,1.62,3.6,3.6S13.98,15.6,12,15.6z', label: 'Settings' },
  ];

  const adminName = localStorage.getItem('wm_admin') || 'Admin';

  const sidebarEl = document.getElementById('adminSidebar');
  if (!sidebarEl) return;

  sidebarEl.innerHTML = `
    <div class="sidebar-logo">
      <div class="logo-text">World<span>Mic</span> <span class="logo-badge">Admin</span></div>
    </div>
    <nav class="sidebar-nav">
      <div class="nav-section-label">Management</div>
      ${nav.map(n => `
        <a href="${n.href}" class="sidebar-link ${n.href === activeLink ? 'active' : ''}">
          <svg viewBox="0 0 24 24"><path d="${n.icon}"/></svg>
          ${n.label}
        </a>`).join('')}
      <div class="nav-section-label" style="margin-top:12px">Site</div>
      <a href="/" target="_blank" class="sidebar-link">
        <svg viewBox="0 0 24 24"><path d="M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"/></svg>
        View Site
      </a>
    </nav>
    <div class="sidebar-footer">
      <a href="#" onclick="logout()">
        <svg viewBox="0 0 24 24" fill="currentColor" style="width:15px;height:15px"><path d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z"/></svg>
        Sign out (${adminName})
      </a>
    </div>`;

  // Topbar avatar
  const avatarEl = document.getElementById('adminAvatar');
  if (avatarEl) avatarEl.textContent = adminName[0].toUpperCase();
}
