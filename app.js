/* app.js - TimeRangePro shared stopwatch logic */

(function () {
  'use strict';

  // ── State ────────────────────────────────────────────
  let startOffset  = 0;     // ms: where the timer starts from
  let stopTarget   = null;  // ms: auto-stop target (null = no limit)
  let elapsed      = 0;     // ms: total elapsed since timer started (relative to offset)
  let startTime    = null;  // performance.now() snapshot when last started
  let running      = false;
  let rafId        = null;

  let laps         = [];
  let lastLapTime  = 0;     // elapsed at last lap
  let prevLapDelta = null;

  // ── DOM refs ─────────────────────────────────────────
  const $ = id => document.getElementById(id);

  const timerDisplay  = $('timerDisplay');
  const timerMain     = $('timerMain');   // HH:MM:SS テキストノード専用 span
  const timerMs       = $('timerMs');
  const timerStatus   = $('timerStatus');
  const progressBar   = $('progressBar');
  const progressStart = $('progressStart');
  const progressEnd   = $('progressEnd');
  const inputStart    = $('inputStart');
  const inputStop     = $('inputStop');
  const btnStartStop  = $('btnStartStop');
  const btnLap        = $('btnLap');
  const btnReset      = $('btnReset');
  const lapList       = $('lapList');
  const lapCount      = $('lapCount');

  // ── Helpers ──────────────────────────────────────────
  function msToDisplay(ms) {
    const sign   = ms < 0 ? '-' : '';
    const abs    = Math.abs(ms);
    const h      = Math.floor(abs / 3600000);
    const m      = Math.floor((abs % 3600000) / 60000);
    const s      = Math.floor((abs % 60000) / 1000);
    const cs     = Math.floor((abs % 1000) / 10);
    const hh = String(h).padStart(2, '0');
    const mm = String(m).padStart(2, '0');
    const ss = String(s).padStart(2, '0');
    const cc = String(cs).padStart(2, '0');
    return { main: `${sign}${hh}:${mm}:${ss}`, ms: cc };
  }

  function parseTimeInput(val) {
    if (!val || !val.trim()) return null;
    val = val.trim();
    // Accepts: HH:MM:SS, MM:SS, SS, HH:MM:SS.cs
    const parts = val.replace(',', '.').split(':');
    let h = 0, m = 0, s = 0;
    if (parts.length === 3) {
      h = parseFloat(parts[0]) || 0;
      m = parseFloat(parts[1]) || 0;
      s = parseFloat(parts[2]) || 0;
    } else if (parts.length === 2) {
      m = parseFloat(parts[0]) || 0;
      s = parseFloat(parts[1]) || 0;
    } else {
      s = parseFloat(parts[0]) || 0;
    }
    return Math.round((h * 3600 + m * 60 + s) * 1000);
  }

  function msToInputFormat(ms) {
    if (ms === null || ms === undefined) return '';
    const h  = Math.floor(ms / 3600000);
    const m  = Math.floor((ms % 3600000) / 60000);
    const s  = Math.floor((ms % 60000) / 1000);
    const cs = Math.floor((ms % 1000) / 10);
    return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}.${String(cs).padStart(2,'0')}`;
  }

  // ── Update UI ────────────────────────────────────────
  function updateDisplay() {
    const currentMs = startOffset + elapsed;
    const { main, ms } = msToDisplay(currentMs);
    timerMain.textContent = main;   // HH:MM:SS のみ更新（span内の.timer-msを壊さない）
    timerMs.textContent = '.' + ms; // .XX 小数点第2位

    // Progress bar
    if (stopTarget !== null && stopTarget > startOffset) {
      const range    = stopTarget - startOffset;
      const progress = Math.min(Math.max(elapsed / range, 0), 1) * 100;
      progressBar.style.width = progress + '%';
    } else {
      progressBar.style.width = '0%';
    }
  }

  function updateStatus() {
    if (running) {
      timerStatus.textContent = 'RUNNING';
      timerDisplay.classList.add('running');
      timerDisplay.classList.remove('finished');
    } else if (elapsed > 0 && stopTarget !== null && (startOffset + elapsed) >= stopTarget) {
      timerStatus.textContent = 'FINISHED';
      timerDisplay.classList.remove('running');
      timerDisplay.classList.add('finished');
    } else if (elapsed > 0) {
      timerStatus.textContent = 'PAUSED';
      timerDisplay.classList.remove('running', 'finished');
    } else {
      timerStatus.textContent = 'READY';
      timerDisplay.classList.remove('running', 'finished');
    }
  }

  function updateButtons() {
    if (running) {
      btnStartStop.textContent = '';
      btnStartStop.innerHTML   = iconPause() + ' Pause';
      btnStartStop.classList.add('running');
      btnStartStop.classList.remove('paused');
      btnLap.disabled = false;
    } else if (elapsed > 0) {
      btnStartStop.innerHTML  = iconPlay() + ' Resume';
      btnStartStop.classList.add('paused');
      btnStartStop.classList.remove('running');
      btnLap.disabled = false;
    } else {
      btnStartStop.innerHTML  = iconPlay() + ' Start';
      btnStartStop.classList.remove('running', 'paused');
      btnLap.disabled = true;
    }
    btnReset.disabled = (elapsed === 0 && !running);
    inputStart.disabled = running;
    inputStop.disabled  = running;
  }

  function updateProgressLabels() {
    const so = parseTimeInput(inputStart.value);
    const st = parseTimeInput(inputStop.value);
    progressStart.textContent = so !== null ? msToInputFormat(so).replace('.00','') : '00:00:00';
    progressEnd.textContent   = st !== null ? msToInputFormat(st).replace('.00','') : '--:--:--';
  }

  // ── Tick loop ────────────────────────────────────────
  function tick() {
    if (!running) return;
    const now  = performance.now();
    elapsed    = (now - startTime) + (elapsed || 0);
    startTime  = now;

    // Auto-stop check
    if (stopTarget !== null && (startOffset + elapsed) >= stopTarget) {
      elapsed  = stopTarget - startOffset;
      running  = false;
      updateDisplay();
      updateStatus();
      updateButtons();
      try { navigator.vibrate && navigator.vibrate([100, 50, 100]); } catch(e){}
      return;
    }

    updateDisplay();
    rafId = requestAnimationFrame(tick);
  }

  // ── Controls ─────────────────────────────────────────
  function handleStartStop() {
    if (running) {
      // Pause
      const now = performance.now();
      elapsed   = (now - startTime) + elapsed;
      running   = false;
      cancelAnimationFrame(rafId);
    } else {
      // Start / Resume
      // Parse inputs only when starting fresh
      if (elapsed === 0) {
        const so = parseTimeInput(inputStart.value);
        const st = parseTimeInput(inputStop.value);
        startOffset = so !== null ? so : 0;
        stopTarget  = st !== null ? st : null;
        updateProgressLabels();
        lastLapTime = 0;
      }
      startTime = performance.now();
      running   = true;
      rafId     = requestAnimationFrame(tick);
    }
    updateStatus();
    updateButtons();
  }

  function handleLap() {
    if (!running && elapsed === 0) return;
    const currentMs  = startOffset + elapsed;
    const split      = elapsed - lastLapTime;
    const lapNum     = laps.length + 1;

    let delta = null;
    if (prevLapDelta !== null) delta = split - prevLapDelta;
    prevLapDelta = split;

    laps.push({ num: lapNum, total: currentMs, split, delta });
    lastLapTime = elapsed;
    renderLap(laps[laps.length - 1]);
    lapCount.textContent = laps.length;
  }

  function handleReset() {
    running  = false;
    elapsed  = 0;
    startTime = null;
    laps     = [];
    lastLapTime = 0;
    prevLapDelta = null;
    cancelAnimationFrame(rafId);

    startOffset = parseTimeInput(inputStart.value) || 0;
    stopTarget  = parseTimeInput(inputStop.value)  || null;

    updateDisplay();
    updateStatus();
    updateButtons();
    updateProgressLabels();
    progressBar.style.width = '0%';
    lapList.innerHTML = '<div class="lap-empty">ラップはまだありません</div>';
    lapCount.textContent = '0';
  }

  // ── Lap rendering ────────────────────────────────────
  function renderLap(lap) {
    // Remove empty message
    const empty = lapList.querySelector('.lap-empty');
    if (empty) empty.remove();

    const el        = document.createElement('div');
    el.className    = 'lap-item';

    const { main: splitMain, ms: splitMs } = msToDisplay(lap.split);
    const { main: totalMain, ms: totalMs } = msToDisplay(lap.total);

    let deltaHtml = '<span class="lap-delta neutral">—</span>';
    if (lap.delta !== null) {
      const sign  = lap.delta > 0 ? '+' : '';
      const cls   = lap.delta > 0 ? 'slower' : lap.delta < 0 ? 'faster' : 'neutral';
      const { main: dm, ms: dms } = msToDisplay(Math.abs(lap.delta));
      const absSign = lap.delta < 0 ? '-' : '+';
      deltaHtml = `<span class="lap-delta ${cls}">${absSign}${dm}.${dms}</span>`;
    }

    el.innerHTML = `
      <span class="lap-num">#${lap.num}</span>
      <span class="lap-split">${splitMain}<small>.${splitMs}</small></span>
      <span class="lap-total">${totalMain}<small>.${totalMs}</small></span>
      ${deltaHtml}
    `;

    lapList.insertBefore(el, lapList.firstChild);
  }

  // ── Theme ────────────────────────────────────────────
  function initTheme() {
    const saved   = localStorage.getItem('trp_theme') || 'dark';
    document.documentElement.setAttribute('data-theme', saved);
    updateThemeBtn(saved);
  }

  function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme');
    const next    = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('trp_theme', next);
    updateThemeBtn(next);
  }

  function updateThemeBtn(theme) {
    const btn = $('btnTheme');
    if (!btn) return;
    btn.setAttribute('aria-label', theme === 'dark' ? 'ライトモードに切替' : 'ダークモードに切替');
    btn.innerHTML = theme === 'dark' ? iconSun() : iconMoon();
  }

  // ── Input handlers ───────────────────────────────────
  function handleTimeInputKey(e) {
    if (e.key === 'Enter') e.target.blur();
  }

  function handleTimeInputBlur(e) {
    const ms = parseTimeInput(e.target.value);
    if (ms !== null) e.target.value = msToInputFormat(ms);
    else if (e.target.value.trim()) e.target.value = '';
    updateProgressLabels();
    // Update offset display if not running
    if (!running) {
      startOffset = parseTimeInput(inputStart.value) || 0;
      stopTarget  = parseTimeInput(inputStop.value)  || null;
      elapsed = 0;
      updateDisplay();
    }
  }

  // ── SVG Icons ────────────────────────────────────────
  function iconPlay()  { return `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`; }
  function iconPause() { return `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>`; }
  function iconSun()   { return `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 7a5 5 0 1 0 0 10A5 5 0 0 0 12 7zm0-5a1 1 0 0 1 1 1v2a1 1 0 0 1-2 0V3a1 1 0 0 1 1-1zm0 16a1 1 0 0 1 1 1v2a1 1 0 0 1-2 0v-2a1 1 0 0 1 1-1zM4.22 5.64a1 1 0 1 1 1.42-1.42l1.41 1.42a1 1 0 0 1-1.41 1.41L4.22 5.64zM17.36 18.78a1 1 0 1 1 1.42-1.42l1.41 1.42a1 1 0 0 1-1.41 1.41l-1.42-1.41zM3 13H1a1 1 0 0 1 0-2h2a1 1 0 0 1 0 2zm20 0h-2a1 1 0 0 1 0-2h2a1 1 0 0 1 0 2zM4.22 18.36l-1.42 1.42a1 1 0 1 1-1.41-1.42l1.41-1.41a1 1 0 0 1 1.42 1.41zM19.78 5.64l-1.42 1.41a1 1 0 0 1-1.41-1.41l1.41-1.42a1 1 0 1 1 1.42 1.42z"/></svg>`; }
  function iconMoon()  { return `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M21.64 13a1 1 0 0 0-1.05-.14 8.05 8.05 0 0 1-3.37.73 8.15 8.15 0 0 1-8.14-8.1 8.59 8.59 0 0 1 .25-2A1 1 0 0 0 8 2.36a10.14 10.14 0 1 0 14 11 1 1 0 0 0-.36-.96z"/></svg>`; }

  // ── Shortcut Modal ───────────────────────────────────
  function buildShortcutModal() {
    if ($('shortcutModal')) return;
    const modal = document.createElement('div');
    modal.id = 'shortcutModal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-label', 'キーボードショートカット');
    modal.innerHTML = `
      <div class="sc-backdrop"></div>
      <div class="sc-panel">
        <div class="sc-header">
          <span class="sc-title">キーボードショートカット</span>
          <button class="icon-btn sc-close" aria-label="閉じる">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
          </button>
        </div>
        <div class="sc-body">
          <div class="sc-group">
            <div class="sc-group-label">タイマー操作</div>
            <div class="sc-row"><kbd>Space</kbd> <span>スタート / 一時停止</span></div>
            <div class="sc-row"><kbd>Enter</kbd> <span>スタート / 一時停止</span></div>
            <div class="sc-row"><kbd>L</kbd> <span>ラップを記録</span></div>
            <div class="sc-row"><kbd>R</kbd> <span>リセット</span></div>
          </div>
          <div class="sc-group">
            <div class="sc-group-label">表示・コピー</div>
            <div class="sc-row"><kbd>C</kbd> <span>現在の時刻をコピー</span></div>
            <div class="sc-row"><kbd>D</kbd> <span>ダーク / ライト切替</span></div>
            <div class="sc-row"><kbd>?</kbd> <span>このヘルプを開く / 閉じる</span></div>
            <div class="sc-row"><kbd>Esc</kbd> <span>このヘルプを閉じる</span></div>
          </div>
          <div class="sc-group">
            <div class="sc-group-label">入力フォーカス中は無効</div>
            <div class="sc-row sc-note"><span>時刻入力欄にフォーカス中はすべてのショートカットが無効になります</span></div>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    modal.querySelector('.sc-backdrop').addEventListener('click', closeShortcutModal);
    modal.querySelector('.sc-close').addEventListener('click', closeShortcutModal);
  }

  function openShortcutModal()  {
    buildShortcutModal();
    $('shortcutModal').classList.add('open');
    document.body.style.overflow = 'hidden';
  }
  function closeShortcutModal() {
    const m = $('shortcutModal');
    if (m) { m.classList.remove('open'); document.body.style.overflow = ''; }
  }

  // ── Copy current time ────────────────────────────────
  function copyCurrentTime() {
    const currentMs = startOffset + elapsed;
    const { main, ms } = msToDisplay(currentMs);
    const text = `${main}.${ms}`;
    navigator.clipboard.writeText(text).then(() => {
      showToast(`コピーしました: ${text}`);
    }).catch(() => {
      showToast('コピーに失敗しました');
    });
  }

  // ── Toast notification ───────────────────────────────
  function showToast(msg) {
    let toast = $('trpToast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'trpToast';
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => toast.classList.remove('show'), 2000);
  }

  // ── Init ─────────────────────────────────────────────
  function init() {
    initTheme();
    updateDisplay();
    updateStatus();
    updateButtons();
    updateProgressLabels();

    btnStartStop.addEventListener('click', handleStartStop);
    btnLap.addEventListener('click', handleLap);
    btnReset.addEventListener('click', handleReset);
    $('btnTheme').addEventListener('click', toggleTheme);

    // Shortcut button (? icon in header)
    const btnShortcut = $('btnShortcut');
    if (btnShortcut) btnShortcut.addEventListener('click', openShortcutModal);

    inputStart.addEventListener('keydown', handleTimeInputKey);
    inputStart.addEventListener('blur', handleTimeInputBlur);
    inputStop.addEventListener('keydown', handleTimeInputKey);
    inputStop.addEventListener('blur', handleTimeInputBlur);

    // ── Keyboard shortcuts ────────────────────────────
    document.addEventListener('keydown', e => {
      if (e.target.tagName === 'INPUT') return;

      // ? → help modal
      if (e.key === '?' || (e.shiftKey && e.code === 'Slash')) {
        e.preventDefault();
        const m = $('shortcutModal');
        m && m.classList.contains('open') ? closeShortcutModal() : openShortcutModal();
        return;
      }
      // Esc → close modal
      if (e.key === 'Escape') { closeShortcutModal(); return; }

      if (e.metaKey || e.ctrlKey || e.altKey) return; // ignore modifier combos

      switch (e.code) {
        case 'Space':
        case 'Enter':  e.preventDefault(); handleStartStop(); break;
        case 'KeyL':   handleLap();   break;
        case 'KeyR':   handleReset(); break;
        case 'KeyC':   copyCurrentTime(); break;
        case 'KeyD':   toggleTheme(); break;
      }
    });

    // PWA install prompt
    let deferredPrompt = null;
    window.addEventListener('beforeinstallprompt', e => {
      e.preventDefault();
      deferredPrompt = e;
      const el = $('installPrompt');
      if (el) {
        el.style.display = 'flex';
        el.querySelector('.btn-install').addEventListener('click', async () => {
          deferredPrompt.prompt();
          const { outcome } = await deferredPrompt.userChoice;
          el.style.display = 'none';
          deferredPrompt = null;
        });
        el.querySelector('.btn-install-dismiss').addEventListener('click', () => {
          el.style.display = 'none';
        });
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();