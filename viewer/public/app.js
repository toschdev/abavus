(() => {
  const dayList = document.getElementById('day-list');
  const sessionList = document.getElementById('session-list');
  const sessionFilter = document.getElementById('session-filter');
  const globalSearch = document.getElementById('global-search');
  const searchResults = document.getElementById('search-results');
  const chainBadge = document.getElementById('chain-badge');
  const breakBanner = document.getElementById('break-banner');
  const chronicleEl = document.getElementById('chronicle');
  const lookupForm = document.getElementById('lookup-form');
  const sessionInput = document.getElementById('session-input');
  const exportBtn = document.getElementById('export-btn');
  const folioKicker = document.getElementById('folio-kicker');
  const folioTitle = document.getElementById('folio-title');
  const folioMeta = document.getElementById('folio-meta');
  const timelineCount = document.getElementById('timeline-count');
  const kindFilters = document.getElementById('kind-filters');

  let allSessions = [];
  let allDays = [];
  let currentSessionId = null;
  let currentDay = null;
  let currentReport = null;
  let currentKind = 'all';
  let searchDebounce = null;

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }[c]));
  }

  function fmtDate(value) {
    if (!value) return '—';
    return new Date(value).toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  }

  function fmtTime(value) {
    if (!value) return '—';
    return new Date(value).toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function fmtDayLabel(day) {
    const d = new Date(`${day}T12:00:00Z`);
    return d.toLocaleDateString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
  }

  function isDay(q) {
    return /^\d{4}-\d{2}-\d{2}$/.test(q || '');
  }

  function relationWord(rel) {
    if (rel === 'turn') return 'from turn';
    if (rel === 'reply') return 'in reply to';
    if (rel === 'cause') return 'because';
    if (rel === 'session') return 'from session';
    return 'because';
  }

  function renderDays(days) {
    allDays = days || [];
    if (!allDays.length) {
      dayList.innerHTML = '<p class="empty">No days yet.</p>';
      return;
    }
    dayList.innerHTML = allDays.map((d) => `
      <button type="button" class="day-item ${d.day === currentDay ? 'active' : ''}" data-day="${esc(d.day)}">
        <span class="day-id">${esc(fmtDayLabel(d.day))}</span>
        <span class="day-meta">${d.entries} acts · ${d.sessions} sessions</span>
      </button>
    `).join('');
  }

  function renderSessionList(sessions) {
    const q = (sessionFilter?.value || '').toLowerCase().trim();
    const filtered = (sessions || []).filter((s) => {
      const id = (s.session_id || '').toLowerCase();
      const meta = `${s.entries} ${fmtDate(s.started)}`.toLowerCase();
      return !q || id.includes(q) || meta.includes(q);
    });

    sessionList.innerHTML = filtered.map((s) => `
      <button type="button" class="session-item ${s.session_id === currentSessionId ? 'active' : ''}" data-session="${esc(s.session_id)}">
        <span class="session-id">${esc((s.session_id || '').slice(0, 22))}${(s.session_id || '').length > 22 ? '…' : ''}</span>
        <span class="session-meta">${s.entries} · ${esc(fmtDate(s.started))}</span>
      </button>
    `).join('') || '<p class="empty">No sessions yet.</p>';
  }

  function kindCounts(items) {
    const c = { done: 0, said: 0, commanded: 0, inferred: 0 };
    for (const it of items) {
      if (c[it.kind] != null) c[it.kind]++;
    }
    return c;
  }

  function filteredItems() {
    const items = currentReport?.timeline || [];
    if (currentKind === 'all') return items;
    return items.filter((it) => it.kind === currentKind);
  }

  function renderChronicle() {
    const report = currentReport;
    if (!report) {
      chronicleEl.innerHTML = '<p class="empty">Nothing open. Choose a day or a session.</p>';
      timelineCount.textContent = '';
      return;
    }

    const items = filteredItems();
    timelineCount.textContent = `${items.length} of ${report.timeline?.length || 0}`;

    if (!items.length) {
      chronicleEl.innerHTML = '<p class="empty">No acts of this kind in this chronicle.</p>';
      return;
    }

    const showChapters = Boolean(report.day) && !currentSessionId;
    let lastSession = null;
    const parts = [];

    for (const item of items) {
      if (showChapters && item.sessionId && item.sessionId !== lastSession) {
        lastSession = item.sessionId;
        parts.push(`<div class="chapter">Session ${esc(item.sessionId.slice(0, 18))}</div>`);
      }

      const cause = item.cause;
      const causeHtml = cause
        ? `<p class="cause">${esc(relationWord(cause.relation))}
             <button type="button" data-jump="${esc(cause.id || '')}">${esc(cause.summary)}</button>
           </p>`
        : '';

      const fields = (item.fields || []).map((f) => `
        <div>
          <span class="field-label">${esc(f.label)}</span>
          <p class="field-value">${esc(f.value)}</p>
        </div>
      `).join('');

      const chainBits = [
        item.signed ? 'signed' : 'unsigned',
        item.prevHash ? `prev ${item.prevHash.slice(0, 12)}…` : 'genesis',
        item.entryHash ? `this ${item.entryHash.slice(0, 12)}…` : '',
      ].filter(Boolean).join(' · ');

      const raw = JSON.stringify({
        id: item.id,
        timestamp: item.timestamp,
        action: item.action,
        kind: item.kind,
        payload: item.payload,
        prevHash: item.prevHash,
        entryHash: item.entryHash,
      }, null, 2);

      parts.push(`
        <article class="act kind-${esc(item.kind)}" id="act-${esc(item.id)}" data-id="${esc(item.id)}">
          <div class="act-head" data-toggle="${esc(item.id)}">
            <time datetime="${esc(item.timestamp)}">${esc(fmtTime(item.timestamp))}</time>
            <span class="kind-mark">${esc(item.kindLabel || item.kind)}</span>
            <span class="act-summary">${esc(item.summary)}</span>
          </div>
          ${causeHtml}
          <div class="act-body">
            <div class="fields">${fields || '<p class="quiet">No further fields.</p>'}</div>
            <div class="chain-meta">${esc(item.action)} · ${esc(item.id)} · ${esc(chainBits)}</div>
            <details class="raw-fold">
              <summary>Raw entry</summary>
              <pre>${esc(raw)}</pre>
            </details>
          </div>
        </article>
      `);
    }

    chronicleEl.innerHTML = parts.join('');
  }

  function setFolioFromReport(report, mode) {
    if (!report) return;
    if (mode === 'day') {
      folioKicker.textContent = 'Day';
      folioTitle.textContent = fmtDayLabel(report.day);
      const kc = kindCounts(report.timeline || []);
      folioMeta.textContent = `${report.entryCount} acts · ${kc.commanded} commanded · ${kc.said} said · ${kc.done} acted · ${kc.inferred} concluded`;
    } else {
      folioKicker.textContent = 'Session';
      folioTitle.textContent = report.sessionId;
      folioMeta.textContent = `${fmtDate(report.started)} → ${fmtDate(report.ended)}${report.durationHuman ? ` · ${report.durationHuman}` : ''} · ${report.entryCount} acts`;
    }
  }

  function paintVerify(verify) {
    chainBadge.classList.remove('ok', 'bad', 'unknown');
    if (verify.valid === true) {
      chainBadge.textContent = `Chain holds · ${verify.entries} entries`;
      chainBadge.classList.add('ok');
      breakBanner.hidden = true;
    } else if (verify.valid === false) {
      const at = verify.brokeAt;
      chainBadge.textContent = 'Chain broken';
      chainBadge.classList.add('bad');
      breakBanner.hidden = false;
      if (at) {
        breakBanner.textContent = `Broke at entry ${at.id} (${at.action}, #${at.index}) — ${at.reason}`;
      } else {
        breakBanner.textContent = (verify.errors && verify.errors[0]) || 'Integrity check failed.';
      }
    } else {
      chainBadge.textContent = verify.message || 'Chain not verified';
      chainBadge.classList.add('unknown');
      breakBanner.hidden = true;
    }
  }

  async function loadSession(id) {
    if (!id) return;
    if (isDay(id)) return loadDay(id);

    currentSessionId = id;
    currentDay = null;
    sessionInput.value = id;

    document.querySelectorAll('.session-item').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.session === id);
    });
    document.querySelectorAll('.day-item').forEach((btn) => btn.classList.remove('active'));

    const res = await fetch(`/api/sessions/${encodeURIComponent(id)}`);
    const data = await res.json();
    if (!res.ok) {
      folioTitle.textContent = 'Could not open';
      folioMeta.innerHTML = `<span class="error">${esc(data.error || 'missing')}</span>`;
      chronicleEl.innerHTML = '';
      currentReport = null;
      return;
    }

    currentReport = data.report;
    currentKind = 'all';
    kindFilters.querySelectorAll('.filter-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.kind === 'all');
    });
    setFolioFromReport(currentReport, 'session');
    renderChronicle();
    renderSessionList(allSessions);

    const hash = '#' + id;
    if (location.hash !== hash) history.replaceState(null, '', hash);
  }

  async function loadDay(day) {
    currentDay = day;
    currentSessionId = null;
    sessionInput.value = day;

    document.querySelectorAll('.day-item').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.day === day);
    });
    document.querySelectorAll('.session-item').forEach((btn) => btn.classList.remove('active'));

    const res = await fetch(`/api/day?date=${encodeURIComponent(day)}`);
    const data = await res.json();
    if (!res.ok) {
      folioTitle.textContent = 'Could not open day';
      chronicleEl.innerHTML = '';
      currentReport = null;
      return;
    }

    currentReport = data.report;
    currentKind = 'all';
    kindFilters.querySelectorAll('.filter-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.kind === 'all');
    });
    setFolioFromReport(currentReport, 'day');
    renderChronicle();
    renderDays(allDays);

    const hash = '#day/' + day;
    if (location.hash !== hash) history.replaceState(null, '', hash);
  }

  function exportCurrent() {
    if (!currentReport) {
      alert('Open a day or session first.');
      return;
    }
    const name = currentReport.sessionId || currentReport.day || 'chronicle';
    const blob = new Blob([JSON.stringify(currentReport, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `chronicle-${name}.json`;
    a.click();
  }

  async function doGlobalSearch(q) {
    if (!q || q.length < 2) {
      searchResults.hidden = true;
      return;
    }
    const res = await fetch(`/api/search?q=${encodeURIComponent(q)}&limit=15`);
    const data = await res.json();
    if (!data.results?.length) {
      searchResults.innerHTML = '<div class="search-hit">No matches</div>';
      searchResults.hidden = false;
      return;
    }
    searchResults.innerHTML = data.results.map((r) => `
      <button type="button" class="search-hit" data-sid="${esc(r.session_id || '')}">
        <span style="color:var(--faint);font-size:0.7rem">${esc(fmtTime(r.timestamp))}</span>
        <strong>${esc(r.action)}</strong> — ${esc(r.summary)}
      </button>
    `).join('');
    searchResults.hidden = false;
  }

  function jumpTo(id) {
    if (!id) return;
    const el = document.getElementById('act-' + id);
    if (!el) return;
    el.classList.add('open');
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function openFromHash() {
    const raw = location.hash.replace(/^#/, '').trim();
    if (!raw) return false;
    if (raw.startsWith('day/')) {
      loadDay(raw.slice(4));
      return true;
    }
    loadSession(raw);
    return true;
  }

  async function init() {
    const [statsRes, verifyRes] = await Promise.all([
      fetch('/api/stats'),
      fetch('/api/verify'),
    ]);
    const stats = await statsRes.json();
    const verify = await verifyRes.json();

    allSessions = stats.sessions || [];
    renderDays(stats.days || []);
    renderSessionList(allSessions);
    paintVerify(verify);

    if (openFromHash()) return;
    if (stats.days?.[0]) {
      loadDay(stats.days[0].day);
    } else if (stats.sessions?.[0]) {
      loadSession(stats.sessions[0].session_id);
    }
  }

  dayList.addEventListener('click', (e) => {
    const btn = e.target.closest('.day-item');
    if (btn) loadDay(btn.dataset.day);
  });

  sessionList.addEventListener('click', (e) => {
    const btn = e.target.closest('.session-item');
    if (btn) loadSession(btn.dataset.session);
  });

  chronicleEl.addEventListener('click', (e) => {
    const jump = e.target.closest('[data-jump]');
    if (jump) {
      e.preventDefault();
      jumpTo(jump.dataset.jump);
      return;
    }
    const toggle = e.target.closest('[data-toggle]');
    if (toggle) {
      const art = toggle.closest('.act');
      if (art) art.classList.toggle('open');
    }
  });

  kindFilters.addEventListener('click', (e) => {
    const btn = e.target.closest('.filter-btn');
    if (!btn) return;
    currentKind = btn.dataset.kind || 'all';
    kindFilters.querySelectorAll('.filter-btn').forEach((b) => {
      b.classList.toggle('active', b === btn);
    });
    renderChronicle();
  });

  sessionFilter.addEventListener('input', () => renderSessionList(allSessions));

  globalSearch.addEventListener('input', () => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => doGlobalSearch(globalSearch.value.trim()), 250);
  });

  searchResults.addEventListener('click', (e) => {
    const hit = e.target.closest('.search-hit');
    if (!hit) return;
    searchResults.hidden = true;
    globalSearch.value = '';
    if (hit.dataset.sid) loadSession(hit.dataset.sid);
  });

  lookupForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const q = sessionInput.value.trim();
    if (isDay(q)) loadDay(q);
    else loadSession(q);
  });

  exportBtn.addEventListener('click', exportCurrent);

  chainBadge.addEventListener('click', async () => {
    const res = await fetch('/api/verify');
    paintVerify(await res.json());
  });

  document.addEventListener('keydown', (e) => {
    const tag = document.activeElement?.tagName;
    const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SEARCH';

    if (e.key === '/' && !typing) {
      e.preventDefault();
      globalSearch.focus();
    } else if (e.key === 'Escape') {
      searchResults.hidden = true;
      if (typing) document.activeElement.blur();
    } else if ((e.key === 'j' || e.key === 'k') && !typing && allSessions.length) {
      e.preventDefault();
      const items = Array.from(sessionList.querySelectorAll('.session-item'));
      if (!items.length) return;
      let idx = items.findIndex((it) => it.classList.contains('active'));
      if (idx === -1) idx = 0;
      idx = e.key === 'j' ? Math.min(idx + 1, items.length - 1) : Math.max(idx - 1, 0);
      loadSession(items[idx].dataset.session);
    }
  });

  window.addEventListener('hashchange', () => openFromHash());

  init();
})();
