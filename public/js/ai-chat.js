/* ===================================
   WORLD MIC - MICA AI ASSISTANT JS
   =================================== */

class MicaAI {
  constructor() {
    this.isOpen = false;
    this.activeTab = 'chat';
    this.chatHistory = [];
    this.pendingAction = null; // when set, the next typed message is routed to a real endpoint, not plain chat
    this.init();
  }

  init() {
    this.injectHTML();
    this.bindEvents();
    this.addWelcomeMessage();
  }

  injectHTML() {
    const html = `
    <div class="ai-fab" id="aiFab">
      <div class="ai-fab-pulse"></div>
      <button class="ai-fab-btn" id="aiFabBtn" title="Open Mica AI Assistant">
        <svg viewBox="0 0 24 24"><path d="M12 2a2 2 0 0 1 2 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 0 1 7 7h1a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-1v1a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-1H2a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1h1a7 7 0 0 1 7-7h1V5.73c-.6-.34-1-.99-1-1.73a2 2 0 0 1 2-2M9 9a1 1 0 0 0-1 1v1a1 1 0 0 0 2 0v-1a1 1 0 0 0-1-1m6 0a1 1 0 0 0-1 1v1a1 1 0 0 0 2 0v-1a1 1 0 0 0-1-1m-3 6a1 1 0 0 0-1 1 1 1 0 0 0 1 1 1 1 0 0 0 1-1 1 1 0 0 0-1-1z"/></svg>
      </button>
      <span class="ai-badge" id="aiBadge" style="display:none">!</span>
    </div>

    <div class="ai-chat-panel" id="aiChatPanel">
      <div class="ai-panel-header">
        <div class="ai-avatar"><svg viewBox="0 0 24 24"><path d="M12 2a2 2 0 0 1 2 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 0 1 7 7h1a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-1v1a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-1H2a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1h1a7 7 0 0 1 7-7h1V5.73c-.6-.34-1-.99-1-1.73a2 2 0 0 1 2-2M9 9a1 1 0 0 0-1 1v1a1 1 0 0 0 2 0v-1a1 1 0 0 0-1-1m6 0a1 1 0 0 0-1 1v1a1 1 0 0 0 2 0v-1a1 1 0 0 0-1-1m-3 6a1 1 0 0 0-1 1 1 1 0 0 0 1 1 1 1 0 0 0 1-1 1 1 0 0 0-1-1z"/></svg></div>
        <div class="ai-header-info">
          <div class="ai-name">Mica — AI Assistant</div>
          <div class="ai-status"><span class="ai-dot"></span> Online & ready</div>
        </div>
        <button class="ai-panel-close" id="aiPanelClose">✕</button>
      </div>

      <div class="ai-panel-tabs">
        <button class="ai-tab active" data-tab="chat">💬 Chat</button>
        <button class="ai-tab" data-tab="actions">⚡ Actions</button>
        <button class="ai-tab" data-tab="logs">📋 Logs</button>
      </div>

      <div id="chatTabContent" style="display:flex;flex-direction:column;flex:1;overflow:hidden;">
        <div class="ai-quick-actions">
          <button class="quick-btn" data-action="generate-post">✏️ Write Post</button>
          <button class="quick-btn" data-action="reply-comments">💬 Reply Comments</button>
          <button class="quick-btn" data-action="trending">🔥 Trending</button>
          <button class="quick-btn" data-action="generate-image">🖼️ Gen Image</button>
        </div>
        <div class="ai-messages" id="aiMessages"></div>
        <div class="ai-input-area">
          <div class="ai-input-row">
            <textarea class="ai-input" id="aiInput" placeholder="Ask Mica anything… 'Write a post about…'" rows="1"></textarea>
            <button class="ai-send-btn" id="aiSendBtn">
              <svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
            </button>
          </div>
        </div>
      </div>

      <div id="actionsTabContent" style="display:none;flex:1;overflow-y:auto;padding:14px;">
        <div style="display:flex;flex-direction:column;gap:10px;">
          <div style="font-size:0.78rem;font-weight:700;color:#7a7a8a;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:4px;">Content</div>
          <button class="quick-btn" style="text-align:left;border-radius:8px;padding:10px 14px;" data-action="generate-post">✏️ Generate New Post</button>
          <button class="quick-btn" style="text-align:left;border-radius:8px;padding:10px 14px;" data-action="reedit-post">🔄 Re-edit Post by ID</button>
          <button class="quick-btn" style="text-align:left;border-radius:8px;padding:10px 14px;" data-action="generate-image">🖼️ Generate Featured Image</button>
          <div style="font-size:0.78rem;font-weight:700;color:#7a7a8a;text-transform:uppercase;letter-spacing:0.08em;margin:8px 0 4px;">Engagement</div>
          <button class="quick-btn" style="text-align:left;border-radius:8px;padding:10px 14px;" data-action="reply-comments">💬 Auto-Reply Comments</button>
          <button class="quick-btn" style="text-align:left;border-radius:8px;padding:10px 14px;" data-action="trending">🔥 Trending Suggestions</button>
        </div>
      </div>

      <div id="logsTabContent" style="display:none;flex:1;overflow-y:auto;">
        <div class="ai-log-panel" id="aiLogList"><div style="text-align:center;padding:20px;color:#9a9aaa;font-size:0.8rem;">Loading logs…</div></div>
      </div>
    </div>`;

    const wrap = document.createElement('div');
    wrap.innerHTML = html;
    document.body.appendChild(wrap);
  }

  bindEvents() {
    document.getElementById('aiFabBtn').addEventListener('click', () => this.toggle());
    document.getElementById('aiPanelClose').addEventListener('click', () => this.close());
    document.getElementById('aiSendBtn').addEventListener('click', () => this.sendMessage());
    document.getElementById('aiInput').addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.sendMessage(); }
    });

    document.querySelectorAll('.quick-btn[data-action]').forEach(btn => {
      btn.addEventListener('click', () => this.handleAction(btn.dataset.action));
    });

    document.querySelectorAll('.ai-tab').forEach(tab => {
      tab.addEventListener('click', () => this.switchTab(tab.dataset.tab));
    });
  }

  toggle() { this.isOpen ? this.close() : this.open(); }

  open() {
    this.isOpen = true;
    document.getElementById('aiChatPanel').classList.add('open');
    document.getElementById('aiFabBtn').classList.add('active');
    document.getElementById('aiBadge').style.display = 'none';
    setTimeout(() => document.getElementById('aiInput').focus(), 300);
  }

  close() {
    this.isOpen = false;
    document.getElementById('aiChatPanel').classList.remove('open');
    document.getElementById('aiFabBtn').classList.remove('active');
  }

  switchTab(tab) {
    this.activeTab = tab;
    document.querySelectorAll('.ai-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
    document.getElementById('chatTabContent').style.display = tab === 'chat' ? 'flex' : 'none';
    document.getElementById('actionsTabContent').style.display = tab === 'actions' ? 'block' : 'none';
    document.getElementById('logsTabContent').style.display = tab === 'logs' ? 'block' : 'none';
    if (tab === 'logs') this.loadLogs();
  }

  addWelcomeMessage() {
    this.appendMessage('ai', `👋 Hi! I'm <strong>Mica</strong>, your World Mic AI assistant.<br><br>I can <strong>write posts</strong>, <strong>generate images</strong>, <strong>reply to comments</strong>, and much more. What can I help you with today?`);
  }

  appendMessage(role, content, extra = '') {
    const msgs = document.getElementById('aiMessages');
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const div = document.createElement('div');
    div.className = `msg ${role}`;
    div.innerHTML = role === 'ai' ? `
      <div class="msg-avatar"><svg viewBox="0 0 24 24" fill="white"><path d="M12 2a2 2 0 0 1 2 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 0 1 7 7h1a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-1v1a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-1H2a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1h1a7 7 0 0 1 7-7h1V5.73c-.6-.34-1-.99-1-1.73a2 2 0 0 1 2-2z"/></svg></div>
      <div><div class="msg-bubble">${content}${extra}</div><div class="msg-time">${time}</div></div>` : `
      <div><div class="msg-bubble">${content}</div><div class="msg-time" style="text-align:right">${time}</div></div>`;
    msgs.appendChild(div);
    msgs.scrollTop = msgs.scrollHeight;
    return div;
  }

  showTyping() {
    const msgs = document.getElementById('aiMessages');
    const div = document.createElement('div');
    div.className = 'msg ai'; div.id = 'typingIndicator';
    div.innerHTML = `<div class="msg-avatar"><svg viewBox="0 0 24 24" fill="white"><path d="M12 2a2 2 0 0 1 2 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 0 1 7 7h1a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-1v1a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-1H2a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1h1a7 7 0 0 1 7-7h1V5.73c-.6-.34-1-.99-1-1.73a2 2 0 0 1 2-2z"/></svg></div><div class="msg-bubble"><div class="typing-indicator"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div></div>`;
    msgs.appendChild(div); msgs.scrollTop = msgs.scrollHeight;
  }

  removeTyping() { document.getElementById('typingIndicator')?.remove(); }

  authHeaders(json = true) {
    const token = localStorage.getItem('wm_token');
    return json
      ? { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
      : { Authorization: `Bearer ${token}` };
  }

  // Every typed message: if an action is pending (we're mid-flow on a real task), route it there.
  // Otherwise it's a normal conversational message to Mica.
  async sendMessage() {
    const input = document.getElementById('aiInput');
    const message = input.value.trim();
    if (!message) return;
    input.value = '';
    this.appendMessage('user', message);

    if (this.pendingAction) {
      const action = this.pendingAction;
      this.pendingAction = null;
      return this.runPendingAction(action, message);
    }
    return this.plainChat(message);
  }

  async plainChat(message) {
    this.showTyping();
    document.getElementById('aiSendBtn').disabled = true;
    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST', headers: this.authHeaders(),
        body: JSON.stringify({ message, history: this.chatHistory.slice(-10) })
      });
      const data = await res.json();
      this.removeTyping();
      if (data.error) { this.appendMessage('ai', `❌ ${data.error}`); return; }
      this.chatHistory = data.messages || [];
      this.appendMessage('ai', data.reply.replace(/\n/g, '<br>'));
    } catch (err) {
      this.removeTyping();
      this.appendMessage('ai', '❌ Connection error. Please try again.');
    } finally {
      document.getElementById('aiSendBtn').disabled = false;
    }
  }

  async runPendingAction(action, userInput) {
    if (action === 'generate-post') return this.doGeneratePost(userInput);
    if (action === 'reedit-post') return this.doReeditPost(userInput);
    if (action === 'generate-image') return this.doGenerateImage(userInput);
    if (action === 'reply-comments') return this.doReplyComments(userInput);
    return this.plainChat(userInput); // fallback safety net
  }

  async doGeneratePost(input) {
    this.showTyping();
    const isUrl = /^https?:\/\/\S+$/i.test(input.trim());
    try {
      const body = isUrl
        ? { sourceUrl: input.trim(), category: 'General', length: 'long' }
        : { topic: input, category: 'General', length: 'long' };
      const res = await fetch('/api/ai/generate-post', {
        method: 'POST', headers: this.authHeaders(),
        body: JSON.stringify(body)
      });
      const data = await res.json();
      this.removeTyping();
      if (data.error) { this.appendMessage('ai', `❌ ${data.error}`); return; }
      const p = data.postData;
      // Save it as a real draft immediately so the task is actually complete, not just previewed
      const createRes = await fetch('/api/posts', {
        method: 'POST', headers: this.authHeaders(),
        body: JSON.stringify({ ...p, status: 'draft', aiGenerated: true })
      });
      const created = await createRes.json();
      if (!createRes.ok) { this.appendMessage('ai', `✅ Article written, but saving as a draft failed: ${created.error || 'unknown error'}<br><br><strong>${p.title}</strong><br>${p.excerpt}`); return; }

      let imageNote = '';
      if (isUrl) {
        this.appendMessage('ai', `✅ Article drafted: <strong>${p.title}</strong><br><br>${p.excerpt}<br><br>Generating a matching image…`);
        this.showTyping();
        try {
          const imgRes = await fetch('/api/ai/generate-image', {
            method: 'POST', headers: this.authHeaders(),
            body: JSON.stringify({ prompt: p.title, postId: created._id, context: p.excerpt })
          });
          const imgData = await imgRes.json();
          this.removeTyping();
          imageNote = imgData.imageUrl ? `<br><br>🖼️ Featured image added.` : `<br><br>(Couldn't generate an image: ${imgData.error || 'unknown error'})`;
        } catch { this.removeTyping(); imageNote = `<br><br>(Image generation failed)`; }
      }
      this.appendMessage('ai', `${isUrl ? '' : `✅ Draft created: <strong>${p.title}</strong><br><br>${p.excerpt}`}${imageNote}<br><br><a href="/admin-create.html?id=${created._id}" style="color:#2563eb;font-weight:600">Open to review & publish →</a>`);
    } catch (err) {
      this.removeTyping();
      this.appendMessage('ai', '❌ Connection error while generating the post.');
    }
  }

  async doReeditPost(input) {
    const [postId, ...rest] = input.split(':');
    const instructions = rest.join(':').trim();
    this.showTyping();
    try {
      const res = await fetch('/api/ai/reedit-post', {
        method: 'POST', headers: this.authHeaders(),
        body: JSON.stringify({ postId: postId.trim(), instructions })
      });
      const data = await res.json();
      this.removeTyping();
      if (data.error) { this.appendMessage('ai', `❌ ${data.error}`); return; }
      const p = data.improved;
      this.appendMessage('ai', `✅ Improved draft ready for <strong>${p.title}</strong>:<br><br>${p.excerpt || ''}<br><br><a href="/admin-create.html?id=${postId.trim()}" style="color:#2563eb;font-weight:600">Open to review & save →</a><br><small style="opacity:0.7">Note: this preview isn't saved yet — open the editor to apply the changes.</small>`);
    } catch (err) {
      this.removeTyping();
      this.appendMessage('ai', '❌ Connection error while re-editing the post.');
    }
  }

  async doGenerateImage(description) {
    this.showTyping();
    try {
      const res = await fetch('/api/ai/generate-image', {
        method: 'POST', headers: this.authHeaders(),
        body: JSON.stringify({ prompt: description })
      });
      const data = await res.json();
      this.removeTyping();
      if (data.error) { this.appendMessage('ai', `❌ ${data.error}`); return; }
      this.appendMessage('ai', `✅ Here's your image:<br><br><img src="${data.imageUrl}" style="max-width:100%;border-radius:10px;margin:6px 0" /><br><a href="${data.imageUrl}" target="_blank" style="color:#2563eb;font-weight:600">Open full size →</a><br><small style="opacity:0.7">Copy this URL into a post's featured image field to use it.</small>`);
    } catch (err) {
      this.removeTyping();
      this.appendMessage('ai', '❌ Connection error while generating the image.');
    }
  }

  async doReplyComments(confirmText) {
    if (!/^(go ahead|yes|confirm|do it|ok|okay|sure)/i.test(confirmText.trim())) {
      this.appendMessage('ai', `No problem — say "go ahead" whenever you're ready, or tell me specific tone instructions first.`);
      this.pendingAction = 'reply-comments'; // stay in this flow until confirmed
      return;
    }
    this.showTyping();
    try {
      const res = await fetch('/api/ai/reply-comments', { method: 'POST', headers: this.authHeaders(), body: JSON.stringify({}) });
      const data = await res.json();
      this.removeTyping();
      if (data.error) { this.appendMessage('ai', `❌ ${data.error}`); return; }
      if (!data.count) { this.appendMessage('ai', `There's nothing to reply to right now — no approved comments are waiting.`); return; }
      const list = data.replies.map(r => `<strong>${r.name}</strong>: ${r.reply}`).join('<br><br>');
      this.appendMessage('ai', `✅ Generated ${data.count} repl${data.count === 1 ? 'y' : 'ies'} (saved as pending — review and send from <a href="/admin-comments.html" style="color:#2563eb;font-weight:600">Comments</a>):<br><br>${list}`);
    } catch (err) {
      this.removeTyping();
      this.appendMessage('ai', '❌ Connection error while generating replies.');
    }
  }

  async handleAction(action) {
    if (localStorage.getItem('wm_role') === 'editor') {
      const proceed = await this.showAdGate();
      if (!proceed) return;
    }
    this.switchTab('chat');
    if (action === 'trending') {
      this.appendMessage('ai', `Let me pull some trending topic ideas for your blog…`);
      this.showTyping();
      try {
        const res = await fetch('/api/ai/trending', { headers: this.authHeaders(false) });
        const data = await res.json();
        this.removeTyping();
        if (data.error) { this.appendMessage('ai', `❌ ${data.error}`); return; }
        if (data.suggestions?.length) {
          const list = data.suggestions.map((s, i) => `<strong>${i+1}. ${s.topic}</strong> (${s.category})<br><small>${s.reason}</small>`).join('<br><br>');
          this.appendMessage('ai', `🔥 Here are your trending suggestions:<br><br>${list}`);
        } else {
          this.appendMessage('ai', `Couldn't generate suggestions right now — try again in a moment.`);
        }
      } catch { this.removeTyping(); this.appendMessage('ai', '❌ Could not fetch suggestions.'); }
      return;
    }

    const prompts = {
      'generate-post': "What topic would you like the article to be about? Or paste a product/article link and I'll research it and write about it (with a matching image).",
      'reedit-post': 'Enter the Post ID, optionally followed by instructions — e.g. "64f2a1c9 : make it more concise".',
      'generate-image': 'Describe the image you want. I\'ll generate it and give you a URL to use.',
      'reply-comments': 'I\'ll auto-generate replies for all approved comments awaiting a reply. Type "go ahead" to confirm.',
    };
    if (prompts[action]) {
      this.appendMessage('ai', prompts[action]);
      this.pendingAction = action;
      document.getElementById('aiInput').focus();
    }
  }

  showAdGate() {
    return new Promise(resolve => {
      const overlay = document.createElement('div');
      overlay.className = 'ai-ad-gate-overlay';
      overlay.innerHTML = `
        <div class="ai-ad-gate-box">
          <div class="ad-label">Sponsored</div>
          <div id="aiAdGateSlot" class="ai-ad-gate-slot"><div class="ai-ad-placeholder">Loading…</div></div>
          <button class="btn btn-primary btn-sm" id="aiAdGateContinue" disabled>Continue in 3s…</button>
        </div>`;
      document.body.appendChild(overlay);
      this.renderAdGateContent(document.getElementById('aiAdGateSlot'));

      let count = 3;
      const btn = document.getElementById('aiAdGateContinue');
      const timer = setInterval(() => {
        count--;
        if (count <= 0) { clearInterval(timer); btn.disabled = false; btn.textContent = 'Continue →'; }
        else btn.textContent = `Continue in ${count}s…`;
      }, 1000);
      btn.addEventListener('click', () => { overlay.remove(); resolve(true); });
    });
  }

  async renderAdGateContent(container) {
    try {
      const res = await fetch('/api/settings');
      const s = await res.json();
      // Only renders a real AdSense unit if explicitly opted in — otherwise a safe internal placeholder
      if (s.adsenseAdminEnabled === 'true' && s.adsenseClientId && s.adsenseSlotInterstitial) {
        container.innerHTML = `<ins class="adsbygoogle" style="display:block;width:100%" data-ad-client="${s.adsenseClientId}" data-ad-slot="${s.adsenseSlotInterstitial}" data-ad-format="auto" data-full-width-responsive="true"></ins>`;
        if (!window.adsbygoogle) {
          const script = document.createElement('script');
          script.async = true; script.crossOrigin = 'anonymous';
          script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${s.adsenseClientId}`;
          document.head.appendChild(script);
        }
        try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch {}
      } else {
        container.innerHTML = `<div class="ai-ad-placeholder">📢 Thanks for using World Mic's AI tools!</div>`;
      }
    } catch {
      container.innerHTML = `<div class="ai-ad-placeholder">📢 Thanks for using World Mic's AI tools!</div>`;
    }
  }

  async loadLogs() {
    const list = document.getElementById('aiLogList');
    list.innerHTML = '<div style="text-align:center;padding:20px;color:#9a9aaa;font-size:0.8rem;">Loading…</div>';
    try {
      const res = await fetch('/api/ai/logs', { headers: this.authHeaders(false) });
      const logs = await res.json();
      if (!logs.length) { list.innerHTML = '<div style="text-align:center;padding:20px;color:#9a9aaa;font-size:0.8rem;">No logs yet.</div>'; return; }
      list.innerHTML = logs.map(l => `
        <div class="log-item ${l.status}">
          <div class="log-action">${l.action.replace(/_/g,' ')}: ${l.target || ''}</div>
          <div class="log-time">${new Date(l.createdAt).toLocaleString()} · ${l.status}</div>
        </div>`).join('');
    } catch { list.innerHTML = '<div style="text-align:center;padding:20px;color:#e63a2e;font-size:0.8rem;">Failed to load logs.</div>'; }
  }
}

// Initialize on admin pages
document.addEventListener('DOMContentLoaded', () => {
  const token = localStorage.getItem('wm_token');
  if (token) new MicaAI();
});
