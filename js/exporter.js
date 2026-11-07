/* exporter.js — ส่งออก CSV (เปิดใน Excel ภาษาไทยได้ ด้วย UTF-8 BOM) และ JSON สำรอง */
(function (root) {
  'use strict';
  const csvCell = v => {
    if (v === null || v === undefined) return '';
    let s = String(v);
    if (/^[=+\-@]/.test(s) && isNaN(Number(s))) s = "'" + s; // กัน CSV/Excel formula injection จากช่องหมายเหตุ
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const toCSV = (header, rows) => '﻿' + [header].concat(rows).map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n';

  function snapshotsCSV(snaps) {
    const head = ['วันที่', 'Futures', 'IV %', 'Basis', 'DTE', 'วัน/ปี', 'Spot', '1SD', '3SD Sell', '2SD Sell', '1SD Sell',
      '1SD Buy', '2SD Buy', '3SD Buy', 'Intraday', 'High จริง', 'Low จริง', 'หมายเหตุ', 'ลิงก์ Drive'];
    const rows = snaps.map(x => {
      const r = GoldCalc.compute(x.inputs), i = x.inputs, a = x.actual || {};
      return [x.date, i.futures, i.iv, i.basis, i.dte, i.daysPerYear, r.spot, r.sd1,
        r.levels[2].sell, r.levels[1].sell, r.levels[0].sell, r.levels[0].buy, r.levels[1].buy, r.levels[2].buy,
        x.intraday && x.intraday.price, a.high, a.low, x.note || '', x.driveUrl || ''];
    });
    return toCSV(head, rows);
  }

  function journalCSV(trades) {
    const head = ['วันที่', 'ฝั่ง', 'ราคาเข้า', 'ราคาออก', 'Stop Loss', 'Take Profit', 'Lots', '$ ต่อ $1/lot', 'กำไร/ขาดทุน (จุด)', 'กำไร/ขาดทุน ($)', 'สถานะ', 'หมายเหตุ'];
    const rows = trades.map(t => {
      const p = GoldCalc.tradePnL(t);
      return [t.date, t.side, t.entry, t.exit, t.sl, t.tp, t.lots, t.multiplier, p && p.points, p && p.usd, p ? 'ปิดแล้ว' : 'ยังเปิดอยู่', t.note || ''];
    });
    return toCSV(head, rows);
  }

  function download(filename, content, mime) {
    const blob = content instanceof Blob ? content : new Blob([content], { type: mime || 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  root.Exporter = { snapshotsCSV, journalCSV, download, toCSV };
})(typeof self !== 'undefined' ? self : this);
