// Shared status banner: a full-width bar pinned to the top of the working tab so it is obvious that the
// extension is driving this tab. pointer-events:none keeps it out of the way of the automation's own clicks.
function nmiBanner(text, opts = {}) {
  let p = document.getElementById('nmi-panel');
  if (!p) {
    p = document.createElement('div'); p.id = 'nmi-panel';
    p.innerHTML = '<style>' +
      '#nmi-panel{position:fixed;top:0;left:0;right:0;z-index:2147483647;pointer-events:none;font:14px/1.35 system-ui,-apple-system,"Segoe UI",sans-serif;color:#fff;background:#0B2A17;box-shadow:0 3px 14px rgba(0,0,0,.4)}' +
      '#nmi-panel .in{display:flex;align-items:center;gap:14px;padding:10px 18px 12px}' +
      '#nmi-panel .dot{width:12px;height:12px;border-radius:50%;background:#03C75A;box-shadow:0 0 0 0 rgba(3,199,90,.7);animation:nmi-pulse 1.2s infinite;flex:none}' +
      '@keyframes nmi-pulse{0%{box-shadow:0 0 0 0 rgba(3,199,90,.7)}70%{box-shadow:0 0 0 10px rgba(3,199,90,0)}100%{box-shadow:0 0 0 0 rgba(3,199,90,0)}}' +
      '#nmi-panel .ttl{font-weight:700;white-space:nowrap}#nmi-panel .ttl small{font-weight:500;opacity:.8;margin-left:8px}' +
      '#nmi-panel .msg{white-space:pre-wrap;opacity:.95;flex:1;min-width:0}' +
      '#nmi-panel .bar{height:4px;background:rgba(255,255,255,.15)}#nmi-panel .bar i{display:block;height:100%;width:0;background:#03C75A;transition:width .3s}' +
      '#nmi-panel.warn{background:#5a3b00}#nmi-panel.warn .dot{background:#FFB020;animation:none}#nmi-panel.warn .bar i{background:#FFB020}' +
      '#nmi-panel.done{background:#0e2a4a}#nmi-panel.done .dot{background:#4aa3ff;animation:none}#nmi-panel.done .bar i{background:#4aa3ff}' +
      '</style><div class="in"><span class="dot"></span><span class="ttl">NAVER Map List Importer<small>automation running — leave this tab alone</small></span><span class="msg"></span></div><div class="bar"><i></i></div>';
    document.documentElement.appendChild(p);
  }
  p.querySelector('.msg').textContent = text;
  const m = text.match(/\[(\d+)\/(\d+)\]/);
  const pct = opts.pct != null ? opts.pct : (m ? Math.round((Number(m[1]) - 1) / Number(m[2]) * 100) : null);
  p.querySelector('.bar i').style.width = (pct == null ? 0 : Math.max(0, Math.min(100, pct))) + '%';
  const mode = opts.mode || (/CAPTCHA|Paused/.test(text) ? 'warn' : /^Done/.test(text) ? 'done' : 'run');
  p.className = mode === 'run' ? '' : mode;
  p.querySelector('.ttl small').textContent = mode === 'warn' ? 'paused — your turn' : mode === 'done' ? 'finished' : 'automation running — leave this tab alone';
}
