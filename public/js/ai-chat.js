/* ===================================
   WORLD MIC - MICA AI ASSISTANT JS
   =================================== */

class MicaAI {
  constructor() {
    this.isOpen = false;
    this.activeTab = 'chat';
    this.chatHistory = [];
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
          <button class="quick-btn" data-cmd="Write a new blog post about trending tech news">✏️ Write Post</button>
          <button class="quick-btn" data-cmd="Reply to all pending comments">💬 Reply Comments</button>
          <button class="quick-btn" data-cmd="Suggest 5 trending post topics for this week">🔥 Trending</button>
          <button class="quick-btn" data-cmd="Generate a featured image for the latest post">🖼️ Gen Image</button>
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

    document.querySelectorAll('.quick-btn[data-cmd]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.getElementById('aiInput').value = btn.dataset.cmd;
        this.sendMessage();
      });
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

  async sendMessage() {
    const input = document.getElementById('aiInput');
    const message = input.value.trim();
    if (!message) return;
    input.value = '';
    this.appendMessage('user', message);
    this.showTyping();
    document.getElementById('aiSendBtn').disabled = true;

    try {
      const token = localStorage.getItem('wm_token');
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
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

  async handleAction(action) {
    this.switchTab('chat');
    const prompts = {
      'generate-post': 'I want to generate a new blog post. What topic would you like to write about? (I\'ll use your saved tone settings)',
      'reedit-post': 'Please enter the Post ID you want to re-edit, and any specific improvement instructions.',
      'generate-image': 'Describe the image you want to generate for your post. I\'ll create a professional featured image.',
      'reply-comments': 'I\'ll auto-generate replies for all approved comments. Say "go ahead" to confirm, or give me special instructions for the tone.',
      'trending': 'Let me analyze current trends and suggest 5 hot topics for your blog right now!'
    };
    if (prompts[action]) {
      this.appendMessage('ai', prompts[action]);
      if (action === 'trending') {
        this.showTyping();
        try {
          const token = localStorage.getItem('wm_token');
          const res = await fetch('/api/ai/trending', { headers: { Authorization: `Bearer ${token}` } });
          const data = await res.json();
          this.removeTyping();
          if (data.suggestions?.length) {
            const list = data.suggestions.map((s, i) => `<strong>${i+1}. ${s.topic}</strong> (${s.category})<br><small>${s.reason}</small>`).join('<br><br>');
            this.appendMessage('ai', `🔥 Here are your trending suggestions:<br><br>${list}`);
          }
        } catch { this.removeTyping(); this.appendMessage('ai', '❌ Could not fetch suggestions.'); }
      }
    }
  }

  async loadLogs() {
    const list = document.getElementById('aiLogList');
    list.innerHTML = '<div style="text-align:center;padding:20px;color:#9a9aaa;font-size:0.8rem;">Loading…</div>';
    try {
      const token = localStorage.getItem('wm_token');
      const res = await fetch('/api/ai/logs', { headers: { Authorization: `Bearer ${token}` } });
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
