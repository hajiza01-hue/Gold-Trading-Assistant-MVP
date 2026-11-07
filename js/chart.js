/* chart.js — กราฟ SD Levels สไตล์แพลตฟอร์มเทรด (SVG ไม่พึ่งไลบรารี ใช้ออฟไลน์ได้)
 * เส้นแนวนอน 7 เส้นเหมือนกราฟใน Excel: ม่วง = Sell, ทอง = Open (Spot), น้ำเงิน = Buy
 * ชื่อระดับอยู่ซ้าย ป้ายราคาอยู่ขวา; Intraday / High / Low (ถ้าผู้ใช้กรอก) แสดงเป็นเส้นเสริม */
(function (root) {
  'use strict';
  const FONT = "'IBM Plex Sans Thai','Noto Sans Thai',system-ui,-apple-system,'Segoe UI',Tahoma,sans-serif";
  const C = {
    bg: '#0B1B33', band1: 'rgba(201,169,110,.10)', band2: 'rgba(201,169,110,.04)', text: '#E8ECF3', dim: '#93A0B8',
    sell: '#B79BFF', buy: '#7FB0FF', open: '#E6C98A', now: '#FFFFFF', hl: '#93A0B8', navy: '#0B1B33',
  };
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const n2 = n => Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const NAME = { sell3: 'Sell 3SD', sell2: 'Sell 2SD', sell1: 'Sell 1SD', open: 'Open (Spot)', buy1: 'Buy 1SD', buy2: 'Buy 2SD', buy3: 'Buy 3SD' };
  const colorOf = kind => (kind === 'sell' ? C.sell : kind === 'buy' ? C.buy : C.open);

  /** จัดตำแหน่งป้ายไม่ให้ซ้อนกัน (ปรับเฉพาะป้าย เส้นยังอยู่ที่ราคาจริง) */
  function spread(items, gap, lo, hi) {
    const a = items.slice().sort((p, q) => p.ly - q.ly);
    for (let i = 1; i < a.length; i++) if (a[i].ly - a[i - 1].ly < gap) a[i].ly = a[i - 1].ly + gap;
    const over = a.length ? a[a.length - 1].ly - hi : 0;
    if (over > 0) a.forEach(o => { o.ly -= over; });
    for (let i = a.length - 2; i >= 0; i--) if (a[i + 1].ly - a[i].ly < gap) a[i].ly = a[i + 1].ly - gap;
    if (a.length && a[0].ly < lo) { const d = lo - a[0].ly; a.forEach(o => { o.ly += d; }); }
  }

  /** res = GoldCalc.compute(...)  opts = {intraday, high, low, width, height, fontPx, title} -> <svg> string */
  function build(res, opts) {
    opts = opts || {};
    const W = Math.max(280, Math.round(opts.width || 360)), H = Math.round(opts.height || 480);
    const fp = opts.fontPx || 14;
    const top = opts.title ? 44 : 20, bottom = 20, padX = 12;
    const lineL = padX + fp * 6.4, lineR = W - padX - fp * 5.6; // เว้นที่ให้ชื่อซ้าย / ป้ายราคาขวา
    const vals = res.chartLines.map(l => l.value);
    [opts.intraday, opts.high, opts.low].forEach(v => { if (isFinite(v)) vals.push(v); });
    const pad = res.sd1 * 0.3;
    const vmax = Math.max.apply(null, vals) + pad, vmin = Math.min.apply(null, vals) - pad;
    const Y = v => top + (vmax - v) / (vmax - vmin) * (H - top - bottom);

    const rows = res.chartLines.map(l => ({ y: Y(l.value), ly: Y(l.value), name: NAME[l.key], price: l.value, color: colorOf(l.kind), w: l.kind === 'open' ? 2.5 : 1.75, dash: '', pill: true }));
    if (isFinite(opts.intraday)) rows.push({ y: Y(opts.intraday), ly: Y(opts.intraday), name: 'ราคาตอนนี้', price: opts.intraday, color: C.now, w: 2, dash: '7 5', pill: true, now: true });
    if (isFinite(opts.high)) rows.push({ y: Y(opts.high), ly: Y(opts.high), name: 'High จริง', price: opts.high, color: C.hl, w: 1.5, dash: '2 5', pill: true });
    if (isFinite(opts.low)) rows.push({ y: Y(opts.low), ly: Y(opts.low), name: 'Low จริง', price: opts.low, color: C.hl, w: 1.5, dash: '2 5', pill: true });
    spread(rows, fp * 1.75, top + fp, H - bottom - fp * 0.6);

    let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="กราฟระดับ SD ของทองคำ" font-family="${FONT}">`;
    s += `<rect width="${W}" height="${H}" rx="${opts.title ? 0 : 16}" fill="${C.bg}"/>`;
    if (opts.title) s += `<text x="${W / 2}" y="28" text-anchor="middle" font-size="${fp + 2}" font-weight="600" fill="${C.text}">${esc(opts.title)}</text>`;
    // โซน 2SD (จางมาก) และ 1SD
    const lv = k => res.chartLines.find(l => l.key === k).value;
    s += `<rect x="${lineL}" y="${Y(lv('sell2'))}" width="${lineR - lineL}" height="${Y(lv('buy2')) - Y(lv('sell2'))}" fill="${C.band2}"/>`;
    s += `<rect x="${lineL}" y="${Y(lv('sell1'))}" width="${lineR - lineL}" height="${Y(lv('buy1')) - Y(lv('sell1'))}" fill="${C.band1}"/>`;
    rows.forEach(r => {
      s += `<line x1="${lineL}" x2="${lineR}" y1="${r.y}" y2="${r.y}" stroke="${r.color}" stroke-width="${r.w}"${r.dash ? ` stroke-dasharray="${r.dash}"` : ''} stroke-linecap="round"/>`;
    });
    const pw = fp * 5.2, ph = fp * 1.5;
    rows.forEach(r => {
      // ชื่อด้านซ้าย
      s += `<text x="${padX}" y="${r.ly + fp * 0.35}" font-size="${fp}" font-weight="${r.name === 'Open (Spot)' ? 600 : 500}" fill="${r.color === C.hl ? C.dim : r.color}">${esc(r.name)}</text>`;
      // ป้ายราคาด้านขวา
      const x = W - padX - pw, y = r.ly - ph / 2;
      if (Math.abs(r.ly - r.y) > 1.5) s += `<path d="M${lineR} ${r.y} L${x} ${r.ly}" stroke="${r.color}" stroke-width="1" opacity=".5" fill="none"/>`;
      s += `<rect x="${x}" y="${y}" width="${pw}" height="${ph}" rx="${ph / 2}" fill="${r.now ? '#fff' : 'none'}" stroke="${r.color}" stroke-width="${r.now ? 0 : 1.25}"/>`;
      s += `<text x="${x + pw / 2}" y="${r.ly + fp * 0.35}" text-anchor="middle" font-size="${fp * 0.93}" font-weight="600" fill="${r.now ? C.navy : r.color === C.hl ? C.text : r.color}" style="font-variant-numeric:tabular-nums">${n2(r.price)}</text>`;
    });
    return s + '</svg>';
  }

  /** แปลง SVG เป็น PNG (Blob) ใช้ดาวน์โหลด/อัปโหลดขึ้น Drive */
  function toPNG(svgString, scale) {
    scale = scale || 2;
    return new Promise((resolve, reject) => {
      const m = svgString.match(/viewBox="0 0 (\d+) (\d+)"/);
      const w = +m[1], h = +m[2];
      const img = new Image();
      img.onload = () => {
        try {
          const c = document.createElement('canvas');
          c.width = w * scale; c.height = h * scale;
          const ctx = c.getContext('2d');
          ctx.fillStyle = C.bg; ctx.fillRect(0, 0, c.width, c.height);
          ctx.drawImage(img, 0, 0, c.width, c.height);
          c.toBlob(b => (b ? resolve(b) : reject(new Error('สร้างรูป PNG ไม่สำเร็จ'))), 'image/png');
        } catch (e) { reject(e); }
      };
      img.onerror = () => reject(new Error('แปลงกราฟเป็นรูปไม่สำเร็จ'));
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgString);
    });
  }

  root.GChart = { build, toPNG, NAME, colors: C };
})(typeof self !== 'undefined' ? self : this);
