/* app.js — ควบคุมหน้าจอ: ภาพรวม, คำนวณ SD, กราฟ, สมุดเทรด, ประวัติ, ตั้งค่า
 * (สูตรอยู่ใน calc.js, ข้อมูลใน store.js, Google ใน sync.js — ไม่เปลี่ยนจากเวอร์ชันก่อน) */
(function () {
  'use strict';
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = s => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (n, d) => (n === null || n === undefined || !isFinite(n)) ? '–' : Number(n).toLocaleString('en-US', { minimumFractionDigits: d === undefined ? 2 : d, maximumFractionDigits: d === undefined ? 2 : d });
  const sgn = (n, d) => (n > 0 ? '+' : n < 0 ? '−' : '') + fmt(Math.abs(n), d);
  const today = () => new Date().toLocaleDateString('sv-SE');
  const blank = v => v === null || v === undefined || String(v).trim() === '';
  const tdate = iso => { try { return new Date(iso + 'T00:00:00').toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' }); } catch (e) { return iso; } };
  const VIEWS = ['dash', 'calc', 'chart', 'journal', 'log', 'settings', 'more'];
  const icon = n => `<svg class="ic" aria-hidden="true"><use href="#i-${n}"/></svg>`;

  let view = 'dash', calcEditingId = null, exampleMode = false, jEditingId = null, lastCalc = null;
  let chartSrc = null, chartCtx = null;

  /* ---------- แจ้งเตือน ---------- */
  function toast(msg, type, ms) {
    const el = document.createElement('div');
    el.className = 'toast ' + (type || '');
    el.textContent = (type === 'error' ? '⚠ ' : type === 'warn' ? 'ℹ ' : '✓ ') + msg;
    el.addEventListener('click', () => el.remove());
    $('#toasts').appendChild(el);
    setTimeout(() => el.remove(), ms || (type === 'error' ? 9000 : 4500));
  }
  function updateBanner() {
    const b = $('#banner'), msgs = [];
    if (!Store.isPersistent()) msgs.push('เบราว์เซอร์ไม่อนุญาตให้เก็บข้อมูลในเครื่อง (อาจเปิดโหมดส่วนตัว) ข้อมูลจะหายเมื่อปิดหน้านี้ — ใช้ "ส่งออก" หรือซิงค์ Google เพื่อสำรอง');
    if (!navigator.onLine) msgs.push('ออฟไลน์อยู่ — ใช้คำนวณและบันทึกได้ตามปกติ ข้อมูลจะซิงค์เมื่อกลับมาออนไลน์');
    b.hidden = !msgs.length;
    b.innerHTML = msgs.map(esc).join('<br>');
  }

  /* ---------- สถานะซิงค์ ---------- */
  let lastSyncError = null;
  function updateChip() {
    const c = $('#sync-chip');
    c.className = 'chip';
    if (!Sync.configured()) { c.textContent = 'ยังไม่เชื่อม Google'; return; }
    const info = Store.syncInfo();
    if (lastSyncError) { c.textContent = '⚠ ซิงค์ไม่สำเร็จ'; c.classList.add('err'); }
    else if (info.pending > 0) { c.textContent = 'รอซิงค์ ' + info.pending + ' รายการ'; c.classList.add('pending'); }
    else if (info.lastSync) { c.textContent = '✓ ซิงค์แล้ว ' + new Date(info.lastSync).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }); c.classList.add('ok'); }
    else { c.textContent = 'เชื่อม Google แล้ว'; c.classList.add('ok'); }
  }
  async function doSync(manual) {
    if (!Sync.configured()) { if (manual) toast('ยังไม่ได้เชื่อม Google — ไปที่ ตั้งค่า', 'warn'); return false; }
    if (!navigator.onLine) { if (manual) toast('ออฟไลน์อยู่ จะซิงค์ให้อัตโนมัติเมื่อกลับมาออนไลน์', 'warn'); return false; }
    try {
      const r = await Sync.syncNow();
      lastSyncError = null; updateChip();
      if (r.pulled) renderCurrent();
      if (manual) toast('ซิงค์สำเร็จ (ส่ง ' + r.pushed + ' · รับ ' + r.pulled + ' รายการ)');
      return true;
    } catch (e) {
      lastSyncError = e.message; updateChip();
      toast((manual ? '' : 'บันทึกในเครื่องแล้ว แต่ ') + 'ซิงค์ไม่สำเร็จ: ' + e.message, manual ? 'error' : 'warn');
      return false;
    }
  }
  const autoSync = () => { if (Store.settings().autoSync) return doSync(false); };

  /* ---------- ชิ้นส่วนแสดงผลที่ใช้ซ้ำ ---------- */
  function ladder(res) {
    return '<table class="lv"><thead><tr><th scope="col">ระดับ</th><th class="buy" scope="col">Buy (ล่าง)</th><th class="sell" scope="col">Sell (บน)</th></tr></thead><tbody>' +
      `<tr class="spot"><td>Spot</td><td colspan="2" style="text-align:right">${fmt(res.spot)}</td></tr>` +
      res.levels.map(l => `<tr><td>${l.k}SD<small>±${fmt(l.sd)}</small></td><td class="buy">${fmt(l.buy)}</td><td class="sell">${fmt(l.sell)}</td></tr>`).join('') +
      '</tbody></table>';
  }
  const EXPLAIN = '<p class="explain"><b>อ่านอย่างไร:</b> Spot คือราคาอ้างอิงของวัน <b>Sell</b> คือระดับราคาด้านบน <b>Buy</b> คือระดับด้านล่าง ' +
    'ตามหลักสถิติ ราคามักอยู่ภายใน 1SD ราว 68% ของเวลา, 2SD ราว 95%, 3SD ราว 99.7% — เป็นกรอบอ้างอิงเชิงทฤษฎี ไม่ใช่คำทำนาย</p>';
  function posLine(price, res, label, light) {
    const p = GoldCalc.position(price, res);
    if (!p) return '';
    return `<div class="pos${light ? ' light' : ''}">${esc(label)} <b>${fmt(price)}</b> อยู่ที่ <b>${sgn(p.z)} SD</b> จาก Spot (${sgn(p.diff)} จุด) · ${esc(p.text)}</div>`;
  }
  function facts(i) {
    return `<dl class="facts"><div><dt>Futures</dt><dd>${fmt(i.futures)}</dd></div><div><dt>IV</dt><dd>${fmt(i.iv)}%</dd></div>` +
      `<div><dt>Basis</dt><dd>${fmt(i.basis)}</dd></div><div><dt>DTE</dt><dd>${fmt(i.dte)}</dd></div></dl>`;
  }
  function legendHTML(o) {
    const c = GChart.colors;
    const it = (col, txt, cls) => `<span><i class="${cls || ''}" style="color:${col}"></i>${txt}</span>`;
    return '<div class="legend">' + it(c.sell, 'Sell (ด้านบน)') + it(c.open, 'Open / Spot') + it(c.buy, 'Buy (ด้านล่าง)') +
      (o && isFinite(o.intraday) ? it('#5b6b86', 'ราคาตอนนี้', 'dash') : '') + (o && (isFinite(o.high) || isFinite(o.low)) ? it('#93A0B8', 'High / Low จริง', 'dot2') : '') + '</div>';
  }

  /* ---------- กราฟ (วาดใหม่ตามความกว้างจริงของจอ) ---------- */
  function drawChart(host) {
    const j = host._job; if (!j) return;
    const w = Math.max(280, host.clientWidth || 340);
    const h = j.kind === 'page' ? (w < 600 ? 540 : Math.min(680, Math.round(w * 0.56))) : j.kind === 'calc' ? 440 : (w < 600 ? 400 : 420);
    const fp = Math.round(14 * Store.settings().fontScale / 1.15 * 10) / 10;
    host.innerHTML = GChart.build(j.res, Object.assign({ width: w, height: h, fontPx: fp }, j.opts));
  }
  function mountChart(sel, res, opts, kind) {
    const host = $(sel); if (!host) return;
    host._job = { res, opts: opts || {}, kind };
    drawChart(host);
  }
  let rzT = null;
  window.addEventListener('resize', () => { clearTimeout(rzT); rzT = setTimeout(() => $$('.chart-host').forEach(drawChart), 150); });

  /* =========================================================
   * ภาพรวม
   * ========================================================= */
  function renderDash() {
    const snaps = Store.list('snapshots'), trades = Store.list('journal');
    const latest = snaps[0];
    let left = '', right = '', res = null, ip, actual;
    if (!latest) {
      left = '<section class="hero"><span class="eyebrow">ยินดีต้อนรับ</span><div class="hero-main"><div><div class="hero-num gold" style="font-size:1.75rem">ยังไม่มีข้อมูล</div></div></div>' +
        '<p style="color:var(--hero-dim)">เริ่มจากกรอกราคาเปิด Futures, IV, Basis และ DTE ที่หน้า "คำนวณ SD" ระบบจะแสดงระดับ Buy / Sell ให้ทันที</p>' +
        '<div class="hero-cta"><button class="btn gold lg" data-go="calc">เริ่มคำนวณ SD วันนี้ ' + icon('arrow') + '</button></div></section>';
    } else {
      res = GoldCalc.compute(latest.inputs);
      const stale = latest.date !== today();
      ip = latest.intraday && latest.intraday.price; actual = latest.actual || {};
      left += `<section class="hero" aria-label="สรุปข้อมูลล่าสุด"><span class="eyebrow">ข้อมูลล่าสุด · ${esc(tdate(latest.date))}</span>${stale ? '<span class="stale">ไม่ใช่ข้อมูลของวันนี้</span>' : ''}` +
        `<div class="hero-main"><div><div class="lbl">ราคา Spot อ้างอิง</div><div class="num hero-num">${fmt(res.spot)}</div></div>` +
        `<div class="hero-sd"><div class="lbl">ระยะ 1SD</div><div class="num">±${fmt(res.sd1)}</div></div></div>` +
        facts(latest.inputs) + (isFinite(ip) ? posLine(ip, res, 'ราคาตอนนี้') : '') +
        '<div class="hero-cta"><button class="btn gold" data-go="calc">' + icon('calc') + 'คำนวณ SD วันนี้</button>' +
        '<button class="btn" data-action="focus-price">บันทึกราคาตอนนี้</button></div></section>';
      left += '<section class="block"><div class="quick"><div class="fld"><label for="q-price">ราคาตอนนี้ (Intraday)</label>' +
        '<div class="inp"><span class="pre">$</span><input id="q-price" inputmode="decimal" placeholder="ราคาบนจอเทรด"></div></div>' +
        '<button class="btn gold" data-action="quick-price">บันทึก</button></div><div class="err" id="q-err"></div></section>';
      left += '<section class="block"><div class="block-head"><h3>ระดับ SD</h3></div>' + ladder(res) + '</section>';
      right += '<section class="block"><div class="block-head"><h3>กราฟระดับ SD</h3><button class="link-btn" data-go="chart">ดูกราฟเต็มหน้า</button></div><div class="chart-host" id="ch-dash"></div></section>';
    }
    // สถิติ
    const S = GoldCalc.summarize(snaps, trades);
    if (S.snapCount) {
      right += '<section class="block"><div class="block-head"><h3>สถิติจากข้อมูลของคุณ</h3></div><div class="figs">' +
        `<div class="fig"><div class="k">จำนวน Snapshot</div><div class="v">${S.snapCount}</div></div>` +
        `<div class="fig"><div class="k">IV เฉลี่ย</div><div class="v">${fmt(S.avgIV)}%</div></div>` +
        `<div class="fig"><div class="k">1SD เฉลี่ย</div><div class="v">${fmt(S.avgSD)}</div></div></div>`;
      if (S.hit) {
        const d = S.hit.days, pct = n => Math.round(n / d * 100) + '%';
        right += `<p class="explain"><b>ราคาจริงแตะระดับ SD บ่อยแค่ไหน</b> (จาก ${d} วันที่กรอก High/Low จริง)</p>` +
          '<table class="lv hit"><thead><tr><th>ระดับ</th><th class="buy">แตะฝั่ง Buy</th><th class="sell">แตะฝั่ง Sell</th></tr></thead><tbody>' +
          [0, 1, 2].map(i => `<tr><td>${i + 1}SD</td><td class="buy">${S.hit.buy[i]}/${d} · ${pct(S.hit.buy[i])}</td><td class="sell">${S.hit.sell[i]}/${d} · ${pct(S.hit.sell[i])}</td></tr>`).join('') +
          `</tbody></table><p class="hint">อยู่ภายใน 1SD ทั้งวัน ${S.hit.inside1}/${d} วัน (${pct(S.hit.inside1)}) · สถิติจากข้อมูลของคุณเอง จำนวนวันน้อยอาจไม่สะท้อนความเป็นจริง</p>`;
      } else {
        right += '<p class="hint" style="margin-top:.8rem">เคล็ดลับ: กรอก "สูงสุด/ต่ำสุดจริง" ของวันในหน้าคำนวณ เพื่อดูว่าราคาแตะระดับ SD บ่อยแค่ไหน</p>';
      }
      right += '</section>';
    }
    if (S.trades) {
      const T = S.trades;
      right += '<section class="block"><div class="block-head"><h3>สรุปการเทรด</h3><button class="link-btn" data-go="journal">เปิดสมุดเทรด</button></div><div class="figs">' +
        `<div class="fig"><div class="k">ปิดแล้ว / ยังเปิด</div><div class="v">${T.closed} / ${T.open}</div></div>` +
        `<div class="fig"><div class="k">อัตราชนะ</div><div class="v">${T.winRate === null ? '–' : Math.round(T.winRate * 100) + '%'}</div></div>` +
        `<div class="fig"><div class="k">รวม (จุด)</div><div class="v ${T.points >= 0 ? 'win' : 'loss'}">${sgn(T.points)}</div></div>` +
        `<div class="fig"><div class="k">รวม ($)</div><div class="v ${T.usd >= 0 ? 'win' : 'loss'}">${sgn(T.usd)}</div></div></div></section>`;
    }
    $('#dash-body').innerHTML = `<div class="dash-grid"><div>${left}</div><div>${right}</div></div>`;
    if (res) mountChart('#ch-dash', res, { intraday: ip, high: actual.high, low: actual.low }, 'preview');
  }

  function quickPrice() {
    const latest = Store.list('snapshots')[0];
    if (!latest) return;
    const inp = $('#q-price'), n = GoldCalc.parseNum(inp.value);
    if (!(n > 0)) { $('#q-err').textContent = 'กรุณากรอกราคาเป็นตัวเลขที่มากกว่า 0'; inp.setAttribute('aria-invalid', 'true'); inp.focus(); return; }
    latest.intraday = Object.assign({}, latest.intraday, { price: n });
    Store.put('snapshots', latest);
    toast('บันทึกราคาตอนนี้ ' + fmt(n) + ' แล้ว'); renderDash(); updateChip(); autoSync();
  }

  /* =========================================================
   * คำนวณ SD
   * ========================================================= */
  const IDS = { futures: 'f-futures', iv: 'f-iv', basis: 'f-basis', dte: 'f-dte', daysPerYear: 'f-days', intraday: 'f-intraday', high: 'f-high', low: 'f-low' };
  const CORE = ['futures', 'iv', 'basis', 'dte', 'daysPerYear'];
  const readRaw = () => { const o = {}; Object.keys(IDS).forEach(k => { o[k] = $('#' + IDS[k]).value; }); return o; };
  function setNote(t) { const n = $('#edit-note'); n.hidden = !t; n.textContent = t || ''; }
  const hideSaved = () => { $('#calc-saved').hidden = true; };

  function updateCalc(showAll) {
    const raw = readRaw(), v = GoldCalc.validate(raw);
    Object.keys(IDS).forEach(k => {
      const show = v.errors[k] && (showAll || !blank(raw[k]));
      $('#e-' + k).textContent = show ? v.errors[k] : '';
      $('#' + IDS[k]).setAttribute('aria-invalid', show ? 'true' : 'false');
    });
    const out = $('#calc-result'), sum = $('#sb-sum');
    if (!CORE.every(k => v.errors[k] === undefined && v.values[k] !== undefined)) {
      lastCalc = null;
      sum.textContent = 'กรอกข้อมูลให้ครบ';
      out.innerHTML = '<div class="empty"><strong>ผลคำนวณจะแสดงที่นี่</strong>กรอกข้อมูลตอนเช้าให้ครบ 4 ช่อง ระดับ Buy / Sell และกราฟจะขึ้นทันที</div>';
      return null;
    }
    const res = GoldCalc.compute(v.values), x = v.values;
    lastCalc = { res, values: x, ok: v.ok, date: $('#f-date').value || today() };
    sum.innerHTML = `<b>Spot ${fmt(res.spot)}</b>1SD ±${fmt(res.sd1)}`;
    let h = `<section class="hero"><span class="eyebrow">ผลคำนวณ · ${esc(tdate(lastCalc.date))}</span>` +
      `<div class="hero-main"><div><div class="lbl">ราคา Spot อ้างอิง</div><div class="num hero-num">${fmt(res.spot)}</div></div>` +
      `<div class="hero-sd"><div class="lbl">ระยะ 1SD</div><div class="num">±${fmt(res.sd1)}</div></div></div>` +
      facts(x) + (x.intraday ? posLine(x.intraday, res, 'ราคา Intraday') : '') + '</section>';
    h += '<section class="block"><div class="block-head"><h3>ระดับ Buy / Sell</h3></div>' + ladder(res) + EXPLAIN + '</section>';
    h += '<section class="block"><div class="block-head"><h3>กราฟ</h3><button class="link-btn" data-action="open-chart-calc">ดูกราฟเต็มหน้า</button></div><div class="chart-host" id="ch-calc"></div>' +
      legendHTML(x) +
      '<div class="actions"><button class="btn sm" data-action="png">' + icon('down') + 'ดาวน์โหลดรูปกราฟ</button>' +
      '<button class="btn sm" data-action="png-drive">' + icon('cloud') + 'ส่งรูปขึ้น Google Drive</button></div></section>';
    out.innerHTML = h;
    mountChart('#ch-calc', res, { intraday: x.intraday, high: x.high, low: x.low }, 'calc');
    return v;
  }

  function resetCalcForm() {
    Object.keys(IDS).forEach(k => { $('#' + IDS[k]).value = ''; });
    $('#f-days').value = Store.settings().daysPerYear;
    $('#f-note').value = ''; $('#f-date').value = today();
    calcEditingId = null; exampleMode = false; setNote(''); hideSaved();
    updateCalc(false);
  }
  function loadExample() {
    const ex = { futures: 3941, iv: 36.46, basis: 10, dte: 0.56, daysPerYear: 365 };
    Object.keys(ex).forEach(k => { $('#' + IDS[k]).value = ex[k]; });
    ['intraday', 'high', 'low'].forEach(k => { $('#' + IDS[k]).value = ''; });
    calcEditingId = null; exampleMode = true; hideSaved();
    setNote('นี่คือค่าตัวอย่างจากไฟล์ Excel ต้นฉบับ ไม่ใช่ราคาตลาดวันนี้ — แก้เป็นค่าจริงก่อนบันทึก');
    updateCalc(false);
  }

  async function saveSnapshot() {
    const v = updateCalc(true);
    if (!v || !v.ok || !$('#f-date').value) {
      if ($('#f-date').value === '') toast('กรุณาเลือกวันที่', 'error');
      const first = $$('#calc-form [aria-invalid="true"]')[0];
      if (first) { if (first.closest('details')) first.closest('details').open = true; first.focus(); }
      toast('ข้อมูลยังไม่ครบหรือไม่ถูกต้อง ดูข้อความสีแดงใต้ช่อง', 'error');
      return;
    }
    if (exampleMode && !confirm('ค่านี้เป็นตัวอย่างจาก Excel ไม่ใช่ราคาตลาดจริง ต้องการบันทึกจริงหรือไม่?')) return;
    const x = v.values;
    const rec = {
      id: calcEditingId || undefined, date: $('#f-date').value,
      inputs: { futures: x.futures, iv: x.iv, basis: x.basis, dte: x.dte, daysPerYear: x.daysPerYear },
      intraday: x.intraday !== undefined ? { price: x.intraday } : {},
      actual: (x.high !== undefined && x.low !== undefined) ? { high: x.high, low: x.low } : {},
      note: $('#f-note').value.trim(),
    };
    const old = calcEditingId && Store.get('snapshots', calcEditingId);
    if (old && old.driveUrl) rec.driveUrl = old.driveUrl;
    if ((x.high !== undefined) !== (x.low !== undefined)) {
      toast('กรอกสูงสุดและต่ำสุดจริงให้ครบทั้งคู่ จึงจะนับในสถิติ', 'warn');
    }
    const saved = Store.put('snapshots', rec);
    calcEditingId = saved.id; exampleMode = false;
    setNote('กำลังแก้ไข Snapshot วันที่ ' + tdate(saved.date) + ' — กด "ล้างค่าเริ่มใหม่" เพื่อเริ่มรายการใหม่');
    const sv = $('#calc-saved');
    sv.innerHTML = icon('check') + '<span>บันทึกแล้วเมื่อ ' + new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) + ' — ดูได้ที่หน้า "ประวัติ" และ "ภาพรวม"</span>';
    sv.hidden = false; window.scrollTo({ top: 0, behavior: 'smooth' });
    toast('บันทึก Snapshot เรียบร้อย'); updateChip();
    if (Sync.configured() && Store.settings().autoSync && navigator.onLine) {
      try { await uploadChart(saved, true); } catch (e) { /* แจ้งใน uploadChart แล้ว */ }
      autoSync();
    }
  }

  /* ---------- รูปกราฟ (PNG) ---------- */
  function exportCtx() { return view === 'chart' && chartCtx ? chartCtx : lastCalc; }
  function exportSVG(c) {
    const v = c.values || {};
    return GChart.build(c.res, { width: 720, height: 900, fontPx: 20, title: 'Gold SD Levels · ' + c.date, intraday: v.intraday, high: v.high, low: v.low });
  }
  async function downloadPNG() {
    const c = exportCtx(); if (!c) return;
    try { Exporter.download('SD_levels_' + c.date + '.png', await GChart.toPNG(exportSVG(c))); toast('ดาวน์โหลดรูปกราฟแล้ว'); }
    catch (e) { Store.logError('png', e); toast('สร้างรูปไม่สำเร็จ: ' + e.message, 'error'); }
  }
  async function uploadChart(snap, silent) {
    const c = exportCtx(); if (!c) return;
    if (!Sync.configured()) { toast('ยังไม่ได้เชื่อม Google — ไปที่ ตั้งค่า', 'warn'); return; }
    try {
      const blob = await GChart.toPNG(exportSVG(c));
      const r = await Sync.uploadToDrive('SD_' + c.date + '_' + (snap ? snap.id.slice(0, 8) : Date.now()) + '.png', blob);
      if (snap) { const s = Store.get('snapshots', snap.id); s.driveUrl = r.url; Store.put('snapshots', s); }
      if (!silent) toast('ส่งรูปกราฟขึ้น Google Drive แล้ว');
    } catch (e) { toast('ส่งรูปขึ้น Drive ไม่สำเร็จ: ' + e.message, 'warn'); throw e; }
  }

  function loadSnapshot(id) {
    const s = Store.get('snapshots', id);
    if (!s) return;
    Object.keys(s.inputs).forEach(k => { $('#' + IDS[k]).value = s.inputs[k]; });
    $('#f-intraday').value = s.intraday && s.intraday.price !== undefined ? s.intraday.price : '';
    $('#f-high').value = s.actual && s.actual.high !== undefined ? s.actual.high : '';
    $('#f-low').value = s.actual && s.actual.low !== undefined ? s.actual.low : '';
    $('#f-note').value = s.note || ''; $('#f-date').value = s.date;
    $('#intra').open = !!(s.intraday && s.intraday.price !== undefined || s.actual && s.actual.high !== undefined || s.note);
    calcEditingId = id; exampleMode = false; hideSaved();
    setNote('กำลังแก้ไข Snapshot วันที่ ' + tdate(s.date) + ' — แก้แล้วกด "บันทึก Snapshot" (กด "ล้างค่าเริ่มใหม่" เพื่อเริ่มรายการใหม่)');
    show('calc');
  }

  /* =========================================================
   * กราฟ (หน้าเต็ม)
   * ========================================================= */
  function renderChart() {
    const snaps = Store.list('snapshots');
    const body = $('#chart-body');
    const haveCalc = !!lastCalc;
    if (!snaps.length && !haveCalc) {
      body.innerHTML = '<div class="empty"><strong>ยังไม่มีข้อมูลสำหรับวาดกราฟ</strong>กรอกข้อมูลที่หน้า "คำนวณ SD" แล้วกลับมาดูกราฟเต็มหน้าที่นี่<br><button class="btn gold" data-go="calc">ไปที่คำนวณ SD</button></div>';
      chartCtx = null; return;
    }
    if (chartSrc === 'calc' && !haveCalc) chartSrc = null;
    if (!chartSrc || (chartSrc !== 'calc' && !Store.get('snapshots', chartSrc))) chartSrc = snaps.length ? snaps[0].id : 'calc';
    let ctx, ip, actual;
    if (chartSrc === 'calc') { ctx = lastCalc; ip = ctx.values.intraday; actual = { high: ctx.values.high, low: ctx.values.low }; }
    else {
      const s = Store.get('snapshots', chartSrc);
      ctx = { res: GoldCalc.compute(s.inputs), date: s.date, values: Object.assign({}, s.inputs, { intraday: s.intraday && s.intraday.price, high: s.actual && s.actual.high, low: s.actual && s.actual.low }) };
      ip = ctx.values.intraday; actual = { high: ctx.values.high, low: ctx.values.low };
    }
    chartCtx = ctx;
    const opts = snaps.map(s => { const r = GoldCalc.compute(s.inputs); return `<option value="${esc(s.id)}"${s.id === chartSrc ? ' selected' : ''}>${esc(tdate(s.date))} · Spot ${fmt(r.spot)}</option>`; });
    if (haveCalc) opts.unshift(`<option value="calc"${chartSrc === 'calc' ? ' selected' : ''}>ค่าที่กำลังกรอกในหน้าคำนวณ (ยังไม่บันทึก)</option>`);
    body.innerHTML = '<div class="chart-toolbar"><div class="fld"><label for="c-src">เลือกข้อมูล</label><select id="c-src">' + opts.join('') + '</select></div>' +
      '<button class="btn" data-action="png">' + icon('down') + 'ดาวน์โหลดรูป</button></div>' +
      `<div class="chart-meta"><div class="fig"><div class="k">Spot</div><div class="v">${fmt(ctx.res.spot)}</div></div><div class="fig"><div class="k">ระยะ 1SD</div><div class="v">±${fmt(ctx.res.sd1)}</div></div>` +
      (isFinite(ip) ? `<div class="fig"><div class="k">ราคาตอนนี้</div><div class="v">${fmt(ip)}</div></div>` : '') + '</div>' +
      '<div class="chart-host" id="ch-page"></div>' + legendHTML({ intraday: ip, high: actual.high, low: actual.low }) +
      (isFinite(ip) ? posLine(ip, ctx.res, 'ราคาตอนนี้', true).replace('class="pos', 'style="margin-top:1rem" class="pos') : '') +
      '<p class="hint" style="margin-top:1rem">แถบสีทองจางคือช่วง ±1SD · เส้นชื่อซ้าย ป้ายราคาขวา · แกนตั้งคือราคา (ไม่มีแกนเวลา เหมือนกราฟใน Excel)</p>';
    mountChart('#ch-page', ctx.res, { intraday: ip, high: actual.high, low: actual.low }, 'page');
  }

  /* =========================================================
   * สมุดเทรด
   * ========================================================= */
  const J = { entry: 'j-entry', exit: 'j-exit', sl: 'j-sl', tp: 'j-tp', lots: 'j-lots' };
  const snapshotForDate = d => Store.list('snapshots').find(s => s.date === d) || null;

  function resetJournalForm() {
    Object.values(J).forEach(id => { $('#' + id).value = ''; $('#' + id).removeAttribute('aria-invalid'); });
    $('#j-lots').value = '1'; $('#j-note').value = ''; $('#j-date').value = today();
    document.querySelector('input[name=j-side][value=BUY]').checked = true;
    Object.keys(J).forEach(k => { $('#je-' + k).textContent = ''; });
    jEditingId = null; $('#j-title').textContent = 'เพิ่มรายการเทรด'; $('#j-cancel').hidden = true;
  }
  function saveTrade() {
    const raw = {}; Object.keys(J).forEach(k => { raw[k] = $('#' + J[k]).value; });
    const errs = {}, val = {};
    const need = (k, label) => { if (blank(raw[k])) { errs[k] = 'กรุณากรอก' + label; return; } const n = GoldCalc.parseNum(raw[k]); if (!(n > 0)) errs[k] = label + ' ต้องเป็นตัวเลขมากกว่า 0'; else val[k] = n; };
    const opt = (k, label) => { if (blank(raw[k])) return; const n = GoldCalc.parseNum(raw[k]); if (!(n > 0)) errs[k] = label + ' ต้องเป็นตัวเลขมากกว่า 0'; else val[k] = n; };
    need('entry', 'ราคาเข้า'); need('lots', 'จำนวน Lot'); opt('exit', 'ราคาออก'); opt('sl', 'Stop Loss'); opt('tp', 'Take Profit');
    Object.keys(J).forEach(k => { $('#je-' + k).textContent = errs[k] || ''; $('#' + J[k]).setAttribute('aria-invalid', errs[k] ? 'true' : 'false'); });
    const date = $('#j-date').value;
    if (!date) { toast('กรุณาเลือกวันที่', 'error'); return; }
    if (Object.keys(errs).length) { $$('#j-form [aria-invalid="true"]')[0].focus(); toast('ข้อมูลยังไม่ถูกต้อง ดูข้อความสีแดงใต้ช่อง', 'error'); return; }
    const old = jEditingId && Store.get('journal', jEditingId);
    const snap = snapshotForDate(date);
    const rec = {
      id: jEditingId || undefined, date, side: document.querySelector('input[name=j-side]:checked').value,
      entry: val.entry, exit: val.exit === undefined ? null : val.exit, sl: val.sl === undefined ? null : val.sl, tp: val.tp === undefined ? null : val.tp,
      lots: val.lots, multiplier: old ? old.multiplier : Store.settings().multiplier,
      note: $('#j-note').value.trim(), snapshotId: snap ? snap.id : null,
    };
    Store.put('journal', rec);
    toast('บันทึกรายการเทรดเรียบร้อย'); resetJournalForm(); renderJournal(); updateChip(); autoSync();
  }
  function editTrade(id) {
    const t = Store.get('journal', id); if (!t) return;
    $('#j-date').value = t.date;
    document.querySelector(`input[name=j-side][value=${t.side}]`).checked = true;
    Object.keys(J).forEach(k => { $('#' + J[k]).value = t[k] === null || t[k] === undefined ? '' : t[k]; });
    $('#j-note').value = t.note || '';
    jEditingId = id; $('#j-title').textContent = 'แก้ไขรายการเทรด'; $('#j-cancel').hidden = false;
    $('#j-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function renderJournal() {
    const list = Store.list('journal');
    const S = GoldCalc.summarize([], list).trades;
    $('#j-summary').innerHTML = S ? '<section class="block" style="margin-bottom:1.4rem"><div class="figs">' +
      `<div class="fig"><div class="k">ปิดแล้ว / ยังเปิด</div><div class="v">${S.closed} / ${S.open}</div></div>` +
      `<div class="fig"><div class="k">อัตราชนะ</div><div class="v">${S.winRate === null ? '–' : Math.round(S.winRate * 100) + '%'}</div></div>` +
      `<div class="fig"><div class="k">รวม (จุด)</div><div class="v ${S.points >= 0 ? 'win' : 'loss'}">${sgn(S.points)}</div></div>` +
      `<div class="fig"><div class="k">รวม ($)</div><div class="v ${S.usd >= 0 ? 'win' : 'loss'}">${sgn(S.usd)}</div></div></div></section>` : '';
    if (!list.length) { $('#j-list').innerHTML = '<div class="empty"><strong>ยังไม่มีรายการเทรด</strong>กรอกฟอร์มเพื่อบันทึกรายการแรก</div>'; return; }
    $('#j-list').innerHTML = `<h3 class="list-title">รายการทั้งหมด (${list.length})</h3><div class="rows">` + list.map(t => {
      const p = GoldCalc.tradePnL(t);
      const snap = (t.snapshotId && Store.get('snapshots', t.snapshotId)) || snapshotForDate(t.date);
      const pos = snap && !snap.deleted ? GoldCalc.position(t.entry, GoldCalc.compute(snap.inputs)) : null;
      return `<article class="row"><div><div class="main"><span class="pill ${t.side}">${t.side === 'BUY' ? 'ซื้อ' : 'ขาย'}</span>${esc(tdate(t.date))}</div>` +
        `<div class="sub num">เข้า ${fmt(t.entry)}${t.exit !== null && t.exit !== undefined ? ' → ออก ' + fmt(t.exit) : ''} · ${fmt(t.lots, 2)} Lot` +
        (t.sl ? ` · SL ${fmt(t.sl)}` : '') + (t.tp ? ` · TP ${fmt(t.tp)}` : '') + '</div>' +
        (pos ? `<div class="sub">ตอนเข้า ${sgn(pos.z)} SD จาก Spot · ${esc(pos.text)}</div>` : '') +
        (t.note ? `<div class="sub">${esc(t.note)}</div>` : '') + '</div>' +
        (p ? `<div class="amt ${p.points >= 0 ? 'win' : 'loss'}">${p.points >= 0 ? 'กำไร' : 'ขาดทุน'} ${sgn(p.points)} จุด<small>${sgn(p.usd)} $</small></div>` : '<div class="amt"><span class="pill open">ยังเปิดอยู่</span></div>') +
        `<div class="acts"><button class="btn sm" data-action="edit-trade" data-id="${esc(t.id)}">แก้ไข</button><button class="btn sm danger" data-action="del-trade" data-id="${esc(t.id)}">ลบ</button></div></article>`;
    }).join('') + '</div>';
  }

  /* =========================================================
   * ประวัติ
   * ========================================================= */
  function renderLog() {
    const q = $('#l-q').value.trim().toLowerCase(), from = $('#l-from').value, to = $('#l-to').value;
    const all = Store.list('snapshots');
    const list = all.filter(s => (!q || s.date.includes(q) || (s.note || '').toLowerCase().includes(q)) && (!from || s.date >= from) && (!to || s.date <= to));
    if (!all.length) { $('#log-list').innerHTML = '<div class="empty"><strong>ยังไม่มี Snapshot</strong>บันทึกจากหน้า "คำนวณ SD" แล้วจะแสดงที่นี่<br><button class="btn gold" data-go="calc">ไปที่คำนวณ SD</button></div>'; return; }
    if (!list.length) { $('#log-list').innerHTML = '<div class="empty"><strong>ไม่พบรายการ</strong>ลองเปลี่ยนคำค้นหาหรือช่วงวันที่</div>'; return; }
    $('#log-list').innerHTML = `<p class="hint" style="margin:0 0 .6rem">แสดง ${list.length} จาก ${all.length} รายการ</p><div class="rows">` + list.map(s => {
      const r = GoldCalc.compute(s.inputs), i = s.inputs, a = s.actual || {};
      return `<details class="hrow"><summary><span><span class="d">${esc(tdate(s.date))}</span><br><span class="m">1SD ±${fmt(r.sd1)} · IV ${fmt(i.iv)}%${isFinite(a.high) ? ' · มี High/Low จริง' : ''}</span></span><span class="n">${fmt(r.spot)}<br><span class="m" style="font-weight:400">Spot</span></span></summary>` +
        `<div class="detail"><p class="num">Futures ${fmt(i.futures)} · IV ${fmt(i.iv)}% · Basis ${fmt(i.basis)} · DTE ${fmt(i.dte)} · ${fmt(i.daysPerYear, 0)} วัน/ปี</p>` + ladder(r) +
        (s.intraday && s.intraday.price ? `<p>ราคา Intraday: <b class="num">${fmt(s.intraday.price)}</b></p>` : '') +
        (isFinite(a.high) ? `<p>ราคาจริง: สูงสุด <b class="num">${fmt(a.high)}</b> · ต่ำสุด <b class="num">${fmt(a.low)}</b></p>` : '') +
        (s.note ? `<p>หมายเหตุ: ${esc(s.note)}</p>` : '') +
        (s.driveUrl && /^https:\/\/(drive|docs)\.google\.com\//.test(s.driveUrl) ? `<p><a class="link" href="${esc(s.driveUrl)}" target="_blank" rel="noopener">เปิดรูปกราฟใน Google Drive</a></p>` : '') +
        `<div class="actions"><button class="btn sm gold" data-action="load-snap" data-id="${esc(s.id)}">เปิด / แก้ไข</button><button class="btn sm" data-action="chart-snap" data-id="${esc(s.id)}">ดูกราฟ</button><button class="btn sm danger" data-action="del-snap" data-id="${esc(s.id)}">ลบ</button></div></div></details>`;
    }).join('') + '</div>';
  }

  /* =========================================================
   * ตั้งค่า
   * ========================================================= */
  function applyPrefs() {
    const s = Store.settings();
    document.documentElement.dataset.theme = s.theme;
    document.documentElement.style.setProperty('--fs', s.fontScale);
    $$('button[data-fs]').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.fs === +s.fontScale)));
    $$('button[data-theme]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.theme === s.theme)));
    const m = document.querySelector('meta[name=theme-color]');
    if (m) m.content = s.theme === 'light' ? '#0B1B33' : '#070F1D';
  }
  function renderSettings() {
    const s = Store.settings();
    $('#s-days').value = s.daysPerYear; $('#s-mult').value = s.multiplier;
    $('#s-url').value = s.apiUrl; $('#s-token').value = s.token; $('#s-auto').checked = !!s.autoSync;
    const errs = Store.errors();
    $('#err-log').innerHTML = errs.length ? errs.map(e => `<div class="errline">${esc(e.t.replace('T', ' ').slice(0, 19))} [${esc(e.ctx)}] ${esc(e.msg)}</div>`).join('') : 'ไม่มีข้อผิดพลาด';
    applyPrefs();
  }
  function saveConn() {
    Store.setSettings({ apiUrl: $('#s-url').value.trim(), token: $('#s-token').value.trim(), autoSync: $('#s-auto').checked });
    updateChip();
  }
  async function testConn() {
    saveConn();
    const st = $('#s-status'); st.textContent = 'กำลังทดสอบ…';
    try {
      const r = await Sync.ping();
      lastSyncError = null; updateChip();
      st.innerHTML = '✓ เชื่อมต่อสำเร็จ' + (r.sheetUrl && /^https:\/\/docs\.google\.com\//.test(r.sheetUrl) ? ` — <a class="link" href="${esc(r.sheetUrl)}" target="_blank" rel="noopener">เปิด Google Sheet</a>` : '');
      toast('เชื่อมต่อ Google สำเร็จ');
    } catch (e) { st.textContent = '✗ ' + e.message; Store.logError('ping', e); renderSettings(); toast(e.message, 'error'); }
  }
  async function backupToDrive() {
    try {
      const blob = new Blob([JSON.stringify(Store.exportAll(), null, 1)], { type: 'application/json' });
      const r = await Sync.uploadToDrive('GTA_backup_' + today() + '.json', blob);
      toast('สำรองขึ้น Google Drive แล้ว');
      if (r.url) $('#s-status').innerHTML = `✓ สำรองแล้ว — <a class="link" href="${esc(r.url)}" target="_blank" rel="noopener">เปิดไฟล์</a>`;
    } catch (e) { toast('สำรองขึ้น Drive ไม่สำเร็จ: ' + e.message, 'error'); }
  }
  function importFile(file) {
    if (!file) return;
    const fr = new FileReader();
    fr.onload = () => {
      try {
        const r = Store.importAll(JSON.parse(String(fr.result)));
        toast('นำเข้าแล้ว: Snapshot ' + r.snapshots + ' · เทรด ' + r.journal + ' รายการ'); updateChip(); renderCurrent();
      } catch (e) { Store.logError('import', e); toast('นำเข้าไม่สำเร็จ: ' + (e instanceof SyntaxError ? 'ไฟล์ไม่ใช่ JSON ที่ถูกต้อง' : e.message), 'error'); }
    };
    fr.onerror = () => toast('อ่านไฟล์ไม่สำเร็จ', 'error');
    fr.readAsText(file);
  }

  /* =========================================================
   * การนำทาง
   * ========================================================= */
  function renderCurrent() {
    if (view === 'dash') renderDash();
    else if (view === 'calc') updateCalc(false);
    else if (view === 'chart') renderChart();
    else if (view === 'journal') renderJournal();
    else if (view === 'log') renderLog();
    else if (view === 'settings') renderSettings();
  }
  function show(v, noScroll) {
    view = v;
    $$('.view').forEach(s => { s.hidden = s.id !== 'view-' + v; });
    const tabOf = (v === 'log' || v === 'settings') ? 'more' : v;
    $$('.tab').forEach(t => { if (t.dataset.view === tabOf) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current'); });
    $$('.side-link').forEach(t => { if (t.dataset.view === v) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current'); });
    if (location.hash !== '#' + v) history.replaceState(null, '', '#' + v);
    renderCurrent();
    if (!noScroll) window.scrollTo(0, 0);
  }

  function bind() {
    $$('.tab,.side-link').forEach(t => t.addEventListener('click', () => show(t.dataset.view)));
    $('#sync-chip').addEventListener('click', () => (Sync.configured() ? doSync(true) : show('settings')));
    $('#calc-form').addEventListener('submit', e => e.preventDefault());
    $('#j-form').addEventListener('submit', e => e.preventDefault());
    $('#calc-form').addEventListener('input', e => {
      if (e.target.id === 'f-futures') { exampleMode = false; if ($('#edit-note').textContent.startsWith('นี่คือค่าตัวอย่าง')) setNote(''); }
      hideSaved(); updateCalc(false);
    });
    $('#btn-save').addEventListener('click', saveSnapshot);
    $('#btn-clear').addEventListener('click', resetCalcForm);
    $('#btn-example').addEventListener('click', loadExample);
    $('#j-save').addEventListener('click', saveTrade);
    $('#j-cancel').addEventListener('click', resetJournalForm);
    ['l-q', 'l-from', 'l-to'].forEach(id => $('#' + id).addEventListener('input', renderLog));
    $('#chart-body').addEventListener('change', e => { if (e.target.id === 'c-src') { chartSrc = e.target.value; renderChart(); } });

    document.addEventListener('click', e => {
      const go = e.target.closest('[data-go]'); if (go) { show(go.dataset.go); return; }
      const fs = e.target.closest('button[data-fs]'); if (fs) { Store.setSettings({ fontScale: +fs.dataset.fs }); applyPrefs(); $$('.chart-host').forEach(drawChart); return; }
      const th = e.target.closest('button[data-theme]'); if (th) { Store.setSettings({ theme: th.dataset.theme }); applyPrefs(); return; }
      const a = e.target.closest('[data-action]'); if (!a) return;
      const id = a.dataset.id;
      switch (a.dataset.action) {
        case 'quick-price': quickPrice(); break;
        case 'focus-price': { const q = $('#q-price'); if (q) { q.scrollIntoView({ behavior: 'smooth', block: 'center' }); q.focus(); } break; }
        case 'open-chart-calc': chartSrc = 'calc'; show('chart'); break;
        case 'png': downloadPNG(); break;
        case 'png-drive': uploadChart(calcEditingId ? Store.get('snapshots', calcEditingId) : null, false).catch(() => {}); break;
        case 'edit-trade': editTrade(id); break;
        case 'del-trade':
          if (confirm('ลบรายการเทรดนี้หรือไม่?')) { Store.remove('journal', id); renderJournal(); updateChip(); autoSync(); toast('ลบรายการแล้ว'); }
          break;
        case 'load-snap': loadSnapshot(id); break;
        case 'chart-snap': chartSrc = id; show('chart'); break;
        case 'del-snap':
          if (confirm('ลบ Snapshot นี้หรือไม่?')) { Store.remove('snapshots', id); if (calcEditingId === id) calcEditingId = null; renderLog(); updateChip(); autoSync(); toast('ลบรายการแล้ว'); }
          break;
      }
    });

    $('#s-save-defaults').addEventListener('click', () => {
      const d = GoldCalc.parseNum($('#s-days').value), m = GoldCalc.parseNum($('#s-mult').value);
      if (!(d > 0) || !(m > 0)) { toast('ค่าต้องเป็นตัวเลขมากกว่า 0', 'error'); return; }
      Store.setSettings({ daysPerYear: d, multiplier: m }); toast('บันทึกค่าเริ่มต้นแล้ว');
      if (!calcEditingId && blank($('#f-futures').value)) $('#f-days').value = d;
    });
    ['s-url', 's-token'].forEach(id => $('#' + id).addEventListener('change', saveConn));
    $('#s-auto').addEventListener('change', saveConn);
    $('#s-test').addEventListener('click', testConn);
    $('#s-sync').addEventListener('click', () => { saveConn(); doSync(true); });
    $('#s-disconnect').addEventListener('click', () => { Store.setSettings({ apiUrl: '', token: '' }); lastSyncError = null; renderSettings(); updateChip(); $('#s-status').textContent = 'ยกเลิกการเชื่อมต่อแล้ว (ข้อมูลในเครื่องและใน Google ยังอยู่)'; });
    $('#x-snap').addEventListener('click', () => Exporter.download('gold_snapshots_' + today() + '.csv', Exporter.snapshotsCSV(Store.list('snapshots').slice().reverse()), 'text/csv;charset=utf-8'));
    $('#x-jour').addEventListener('click', () => Exporter.download('gold_journal_' + today() + '.csv', Exporter.journalCSV(Store.list('journal').slice().reverse()), 'text/csv;charset=utf-8'));
    $('#x-json').addEventListener('click', () => Exporter.download('GTA_backup_' + today() + '.json', JSON.stringify(Store.exportAll(), null, 1), 'application/json'));
    $('#x-drive').addEventListener('click', backupToDrive);
    $('#x-import').addEventListener('change', e => { importFile(e.target.files[0]); e.target.value = ''; });
    $('#err-clear').addEventListener('click', () => { Store.clearErrors(); renderSettings(); });
    $('#wipe').addEventListener('click', () => {
      if (confirm('ลบข้อมูลทั้งหมดในเครื่องนี้? (แนะนำให้ส่งออกสำรองก่อน)') && confirm('ยืนยันอีกครั้ง: ลบจริง ๆ ใช่หรือไม่?')) {
        const keep = Store.settings(); Store.wipe(); Store.setSettings(keep); resetCalcForm(); resetJournalForm(); renderCurrent(); updateChip(); toast('ลบข้อมูลในเครื่องแล้ว');
      }
    });

    window.addEventListener('online', () => { updateBanner(); if (Store.syncInfo().pending) doSync(false); });
    window.addEventListener('offline', updateBanner);
    window.addEventListener('hashchange', () => { const v = location.hash.slice(1); if (VIEWS.includes(v) && v !== view) show(v); });
    window.addEventListener('error', e => Store.logError('js', e.error || e.message));
    window.addEventListener('unhandledrejection', e => Store.logError('promise', e.reason));
    Store.onEvent(ev => { if (ev === 'persist-failed') { updateBanner(); toast('บันทึกลงเครื่องไม่สำเร็จ (พื้นที่เต็มหรือโหมดส่วนตัว) กรุณาส่งออกข้อมูลสำรอง', 'error'); } });
  }

  function start() {
    const r = Store.init();
    Store.setSettings({}); // ทดสอบเขียน เพื่อรู้ว่า persistent หรือไม่
    applyPrefs(); bind();
    resetCalcForm(); resetJournalForm();
    updateBanner(); updateChip();
    if (r.corrupt) toast('พบข้อมูลในเครื่องเสียหาย — เก็บสำเนาไว้แล้วและเริ่มใหม่ (ถ้ามีข้อมูลใน Google ให้กดซิงค์เพื่อดึงกลับ)', 'error', 12000);
    const v = location.hash.slice(1);
    show(VIEWS.includes(v) ? v : 'dash', true);
    if (Sync.configured() && navigator.onLine) doSync(false);
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
      navigator.serviceWorker.register('sw.js').catch(e => Store.logError('sw', e));
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
