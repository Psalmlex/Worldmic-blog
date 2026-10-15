/* Post-page engagement extras: reading progress bar, emoji reactions, WhatsApp share.
   Purely additive — injects into the page after the post renders and silently does
   nothing if anything it needs is missing. */
(function () {
  var REACTIONS = [['fire', '🔥'], ['laugh', '😂'], ['wow', '😮'], ['hundred', '💯']];
  var KEY = 'wm_reacted';

  function reacted() { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { return {}; } }
  function saveReacted(o) { try { localStorage.setItem(KEY, JSON.stringify(o)); } catch (e) {} }

  function progressBar() {
    if (document.getElementById('readProgress')) return;
    var bar = document.createElement('div');
    bar.id = 'readProgress';
    document.body.appendChild(bar);
    var ticking = false;
    function update() {
      var h = document.documentElement;
      var max = h.scrollHeight - h.clientHeight;
      bar.style.width = (max > 0 ? Math.min(100, (h.scrollTop / max) * 100) : 0) + '%';
      ticking = false;
    }
    window.addEventListener('scroll', function () { if (!ticking) { ticking = true; requestAnimationFrame(update); } }, { passive: true });
    update();
  }

  function render(bar, counts, postId) {
    var mine = (reacted()[postId]) || [];
    bar.innerHTML = '<div class="react-label">How did this one hit?</div><div class="react-row">' +
      REACTIONS.map(function (r) {
        return '<button type="button" class="react-btn' + (mine.indexOf(r[0]) > -1 ? ' on' : '') + '" data-type="' + r[0] + '"><span class="react-emoji">' + r[1] + '</span><span class="react-count">' + (counts[r[0]] || 0) + '</span></button>';
      }).join('') + '</div>';
  }

  function reactions(area, postId) {
    if (document.getElementById('reactBar')) return;
    var bar = document.createElement('div');
    bar.id = 'reactBar';
    bar.className = 'react-bar';
    var anchor = area.querySelector('.like-btn');
    var row = anchor ? anchor.parentElement : null;
    if (row) row.parentElement.insertBefore(bar, row); else area.appendChild(bar);
    var counts = {};
    render(bar, counts, postId);
    fetch('/api/posts/' + postId + '/reactions').then(function (r) { return r.ok ? r.json() : {}; }).then(function (c) { counts = c || {}; render(bar, counts, postId); }).catch(function () {});
    bar.addEventListener('click', function (e) {
      var btn = e.target.closest('.react-btn');
      if (!btn) return;
      var type = btn.getAttribute('data-type');
      var all = reacted(); var mine = all[postId] || [];
      if (mine.indexOf(type) > -1) return;
      fetch('/api/posts/' + postId + '/react', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: type }) })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (c) {
          if (!c) return;
          counts = c; mine.push(type); all[postId] = mine; saveReacted(all);
          render(bar, counts, postId);
          var nb = bar.querySelector('[data-type="' + type + '"]'); if (nb) nb.classList.add('pop');
        }).catch(function () {});
    });
  }

  function whatsapp(area) {
    var anchor = area.querySelector('.like-btn');
    if (!anchor || document.getElementById('waShareBtn')) return;
    var b = document.createElement('button');
    b.id = 'waShareBtn'; b.type = 'button'; b.className = 'btn btn-sm btn-secondary';
    b.textContent = '💬 WhatsApp';
    b.onclick = function () {
      var t = document.title.replace(' — World Mic', '');
      window.open('https://wa.me/?text=' + encodeURIComponent(t + ' ' + location.href), '_blank', 'noopener');
    };
    anchor.parentElement.appendChild(b);
  }

  function init() {
    progressBar();
    var tries = 0;
    var timer = setInterval(function () {
      tries++;
      var area = document.querySelector('.post-content-area');
      var id = window.__POST_ID__ || (typeof postId !== 'undefined' ? postId : null);
      if (area && id && area.querySelector('.like-btn')) {
        clearInterval(timer);
        reactions(area, id); whatsapp(area);
      } else if (tries > 40) clearInterval(timer);
    }, 250);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
