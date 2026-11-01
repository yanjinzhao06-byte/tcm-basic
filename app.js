/* ============================================================
 *  app.js — 公共脚本：本地记录 / 打卡 / 朗读 / 逐字比对
 *  不联网、不上传，全部存在这台设备的 localStorage 里
 * ============================================================ */
(function () {
  'use strict';

  var K = 'tcm.v1.';

  /* ---------------- 存储 ---------------- */
  function get(key, def) {
    try {
      var v = localStorage.getItem(K + key);
      return v === null ? def : JSON.parse(v);
    } catch (e) { return def; }
  }
  function set(key, val) {
    try { localStorage.setItem(K + key, JSON.stringify(val)); } catch (e) {}
  }

  /* ---------------- 日期 ---------------- */
  function ymd(d) {
    d = d || new Date();
    var m = d.getMonth() + 1, day = d.getDate();
    return d.getFullYear() + '-' + (m < 10 ? '0' + m : m) + '-' + (day < 10 ? '0' + day : day);
  }
  function dayDiff(a, b) { // 相差天数
    var pa = a.split('-'), pb = b.split('-');
    var da = new Date(+pa[0], +pa[1] - 1, +pa[2]);
    var db = new Date(+pb[0], +pb[1] - 1, +pb[2]);
    return Math.round((db - da) / 86400000);
  }

  /* ---------------- 打卡 ---------------- */
  function checkin() {
    var t = ymd();
    var s = get('streak', { last: '', n: 0, days: [], first: t });
    if (s.last === t) return s;
    if (s.last) {
      var gap = dayDiff(s.last, t);
      s.n = gap === 1 ? (s.n || 0) + 1 : 1;
    } else {
      s.n = 1;
      s.first = t;
    }
    s.last = t;
    s.days = (s.days || []).concat([t]).slice(-400);
    set('streak', s);
    return s;
  }
  function streak() {
    var s = get('streak', { last: '', n: 0, days: [] });
    if (s.last && dayDiff(s.last, ymd()) > 1) s.n = 0;   // 断了
    return s;
  }

  /* ---------------- 词 / 名解 记录 ---------------- */
  function learned() { return get('learned', {}); }
  function markLearned(w, on) {
    var o = learned();
    if (on === false) delete o[w]; else o[w] = ymd();
    set('learned', o);
    renderProgress();
    return o;
  }
  function mjStat() { return get('mj', {}); }   // {id:{tries,best,last}}
  function mjRecord(id, ratio) {
    var o = mjStat();
    var it = o[id] || { tries: 0, best: 0, last: '' };
    it.tries++;
    it.best = Math.max(it.best || 0, ratio);
    it.last = ymd();
    it.lastRatio = ratio;
    o[id] = it;
    set('mj', o);
  }

  /* ---------------- 总进度 ---------------- */
  function termTotal() {
    if (!window.TERMS_DATA) return 0;
    var n = 0;
    TERMS_DATA.groups.forEach(function (g) { n += g.terms.length; });
    return n;
  }
  function progress() {
    var total = termTotal();
    var done = Object.keys(learned()).length;
    return { total: total, done: done, pct: total ? Math.round(done / total * 100) : 0 };
  }
  function renderProgress() {
    var p = progress();
    var els = document.querySelectorAll('[data-prog]');
    for (var i = 0; i < els.length; i++) {
      var e = els[i];
      if (e.dataset.prog === 'bar') e.style.width = p.pct + '%';
      else if (e.dataset.prog === 'pct') e.textContent = p.pct + '%';
      else if (e.dataset.prog === 'done') e.textContent = p.done;
      else if (e.dataset.prog === 'total') e.textContent = p.total;
    }
    // 各组进度条
    if (window.TERMS_DATA) {
      var rows = document.querySelectorAll('[data-gprog]');
      for (var j = 0; j < rows.length; j++) {
        var gid = rows[j].dataset.gprog;
        var g = TERMS_DATA.groups.filter(function (x) { return x.id === gid; })[0];
        if (!g) continue;
        var L = learned(), c = 0;
        g.terms.forEach(function (t) { if (L[t.w]) c++; });
        var pct = Math.round(c / g.terms.length * 100);
        rows[j].style.width = pct + '%';
      }
    }
  }

  /* ---------------- 朗读（浏览器自带 TTS） ---------------- */
  var voice = null;
  function pickVoice() {
    if (!('speechSynthesis' in window)) return null;
    var vs = window.speechSynthesis.getVoices() || [];
    var zh = vs.filter(function (v) { return /zh|cmn|Chinese/i.test(v.lang + ' ' + v.name); });
    voice = zh.filter(function (v) { return /zh[-_]CN|Chinese.*China|普通话|Ting|Huihui|Yaoyao|Xiaoxiao/i.test(v.lang + ' ' + v.name); })[0] || zh[0] || null;
    return voice;
  }
  if ('speechSynthesis' in window) {
    pickVoice();
    window.speechSynthesis.onvoiceschanged = pickVoice;
  }
  function speak(text, btn) {
    if (!('speechSynthesis' in window)) { alert('这个浏览器不支持朗读，换 Safari / Chrome / Edge 试试。'); return; }
    window.speechSynthesis.cancel();
    var u = new SpeechSynthesisUtterance(text);
    u.lang = 'zh-CN';
    u.rate = 0.88;        // 慢一点，0 基础要慢
    u.pitch = 1;
    if (!voice) pickVoice();
    if (voice) u.voice = voice;
    var old = btn ? btn.textContent : '';
    if (btn) btn.textContent = '⏸';
    u.onend = function () { if (btn) btn.textContent = old || '🔊'; };
    u.onerror = function () { if (btn) btn.textContent = old || '🔊'; };
    window.speechSynthesis.speak(u);
  }

  /* ---------------- 逐字比对（LCS diff） ---------------- */
  function norm(s) {
    return (s || '').replace(/\s+/g, '')
      .replace(/[，。、；：""''（）,.;:"'()!?！？]/g, '');
  }
  // 返回 [{c:'=', ch:''}|{c:'-', ch:''}(输入多余)|{c:'+', ch:''}(漏了)]
  function diff(input, answer) {
    var A = norm(input), B = norm(answer);
    var n = A.length, m = B.length;
    var dp = [], i, j;
    for (i = 0; i <= n; i++) { dp[i] = new Array(m + 1).fill(0); }
    for (i = 1; i <= n; i++) {
      for (j = 1; j <= m; j++) {
        dp[i][j] = A[i - 1] === B[j - 1]
          ? dp[i - 1][j - 1] + 1
          : Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
    var out = [];
    i = n; j = m;
    while (i > 0 && j > 0) {
      if (A[i - 1] === B[j - 1]) { out.push({ c: '=', ch: A[i - 1] }); i--; j--; }
      else if (dp[i - 1][j] >= dp[i][j - 1]) { out.push({ c: '-', ch: A[i - 1] }); i--; }
      else { out.push({ c: '+', ch: B[j - 1] }); j--; }
    }
    while (i > 0) { out.push({ c: '-', ch: A[i - 1] }); i--; }
    while (j > 0) { out.push({ c: '+', ch: B[j - 1] }); j--; }
    return out.reverse();
  }
  function ratio(input, answer) {
    var B = norm(answer).length || 1;
    var hit = diff(input, answer).filter(function (x) { return x.c === '='; }).length;
    return hit / B;
  }
  function renderDiff(input, answer) {
    var d = diff(input, answer), html = '';
    d.forEach(function (x) {
      if (x.c === '=') html += '<span class="c-ok">' + esc(x.ch) + '</span>';
      else if (x.c === '-') html += '<span class="c-bad">' + esc(x.ch) + '</span>';
      else html += '<span class="c-miss">' + esc(x.ch) + '</span>';
    });
    return html;
  }

  /* ---------------- 小工具 ---------------- */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function qs(k) {
    var m = new RegExp('[?&]' + k + '=([^&#]*)').exec(location.search);
    return m ? decodeURIComponent(m[1]) : '';
  }
  function lvMark(lv) {
    return lv === 3 ? '🔥 必考' : lv === 2 ? '⭐ 常考' : '○ 了解';
  }

  window.TCM = {
    get: get, set: set, ymd: ymd,
    checkin: checkin, streak: streak,
    learned: learned, markLearned: markLearned,
    mjStat: mjStat, mjRecord: mjRecord,
    progress: progress, renderProgress: renderProgress,
    speak: speak,
    diff: diff, ratio: ratio, renderDiff: renderDiff, norm: norm,
    esc: esc, qs: qs, lvMark: lvMark
  };
})();
