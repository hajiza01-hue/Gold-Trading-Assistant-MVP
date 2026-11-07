/* calc.js — สูตรคำนวณทั้งหมด (ย้ายจาก Gold_SD_Calculator.xlsx แบบตรงตัว)
 *
 * สูตรต้นฉบับใน Excel (ชีต "SD Calculator"):
 *   B11  Spot อ้างอิง = B4 - B6                       -> Futures - Basis
 *   B12  1SD ($)      = B4*(B5/100)*SQRT(B7/B8)       -> Futures × (IV/100) × √(DTE/365)
 *   B15..B17 ระยะ SD  = B12 × k   (k = 1,2,3)
 *   C15..C17 Buy      = Spot - ระยะ SD
 *   D15..D17 Sell     = Spot + ระยะ SD
 *
 * ไฟล์นี้ไม่แตะ DOM — ใช้ได้ทั้งในเบราว์เซอร์และ Node (สำหรับ tests)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GoldCalc = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const THAI_DIGITS = '๐๑๒๓๔๕๖๗๘๙';

  /** แปลงข้อความที่ผู้ใช้พิมพ์เป็นตัวเลข รองรับ "3,941.50", เลขไทย, ช่องว่าง; ไม่ได้ -> NaN */
  function parseNum(v) {
    if (typeof v === 'number') return isFinite(v) ? v : NaN;
    if (v === null || v === undefined) return NaN;
    let s = String(v).trim().replace(/[๐-๙]/g, d => String(THAI_DIGITS.indexOf(d))).replace(/[,\s]/g, '');
    if (s === '' || !/^[-+]?(\d+\.?\d*|\.\d+)$/.test(s)) return NaN;
    return Number(s);
  }

  const isBlank = v => v === null || v === undefined || String(v).trim() === '';

  /**
   * ตรวจข้อมูลที่กรอก  raw = {futures, iv, basis, dte, daysPerYear, intraday?, high?, low?}
   * คืน {ok, errors:{field:ข้อความไทย}, values:{...ตัวเลข}}
   */
  function validate(raw) {
    const errors = {};
    const values = {};
    const req = (key, label, rule) => {
      const n = parseNum(raw[key]);
      if (isBlank(raw[key])) { errors[key] = 'กรุณากรอก' + label; return; }
      if (isNaN(n)) { errors[key] = label + ' ต้องเป็นตัวเลข'; return; }
      const msg = rule && rule(n);
      if (msg) { errors[key] = msg; return; }
      values[key] = n;
    };
    const opt = (key, label, rule) => {
      if (isBlank(raw[key])) return;
      const n = parseNum(raw[key]);
      if (isNaN(n)) { errors[key] = label + ' ต้องเป็นตัวเลข'; return; }
      const msg = rule && rule(n);
      if (msg) { errors[key] = msg; return; }
      values[key] = n;
    };
    const positive = label => n => (n > 0 ? '' : label + ' ต้องมากกว่า 0');

    req('futures', 'ราคาเปิด Futures', positive('ราคาเปิด Futures'));
    req('iv', 'IV / Vol (%)', n => (n <= 0 ? 'IV ต้องมากกว่า 0' : n > 300 ? 'IV สูงผิดปกติ (เกิน 300%) กรุณาตรวจอีกครั้ง' : ''));
    req('basis', 'Basis', n => (Math.abs(n) > 1000 ? 'Basis ผิดปกติ (เกิน ±1,000) กรุณาตรวจอีกครั้ง' : ''));
    req('dte', 'DTE', n => (n <= 0 ? 'DTE ต้องมากกว่า 0 (เช่น 0.56)' : n > 3650 ? 'DTE มากเกินไป' : ''));
    req('daysPerYear', 'จำนวนวันต่อปี', positive('จำนวนวันต่อปี'));
    opt('intraday', 'ราคา Intraday', positive('ราคา Intraday'));
    opt('high', 'ราคาสูงสุดของวัน', positive('ราคาสูงสุดของวัน'));
    opt('low', 'ราคาต่ำสุดของวัน', positive('ราคาต่ำสุดของวัน'));
    if (values.high !== undefined && values.low !== undefined && values.high < values.low) {
      errors.high = 'ราคาสูงสุดต้องไม่ต่ำกว่าราคาต่ำสุด';
    }
    if (values.futures !== undefined && values.basis !== undefined && values.futures - values.basis <= 0) {
      errors.basis = 'Futures − Basis ต้องมากกว่า 0';
    }
    return { ok: Object.keys(errors).length === 0, errors, values };
  }

  const f2 = n => (Math.round(n * 100) / 100 === 0 ? 0 : n).toFixed(2); // เทียบ TEXT(x,"0.00") ใน Excel

  /** คำนวณตามสูตร Excel ทุกประการ */
  function compute(inp) {
    const futures = inp.futures, iv = inp.iv, basis = inp.basis, dte = inp.dte;
    const daysPerYear = inp.daysPerYear === undefined ? 365 : inp.daysPerYear;
    const spot = futures - basis;                                   // B11
    const sd1 = futures * (iv / 100) * Math.sqrt(dte / daysPerYear); // B12
    const levels = [1, 2, 3].map(k => {
      const sd = sd1 * k;                                           // B15:B17
      return { k, sd, buy: spot - sd, sell: spot + sd };            // C, D
    });
    const L = k => levels[k - 1];
    // ลำดับเดียวกับตาราง "ข้อมูลสำหรับกราฟ" (A25:A31) — บน → ล่าง
    const chartLines = [
      { key: 'sell3', kind: 'sell', k: 3, value: L(3).sell, label: '3 SD Sell - ' + f2(L(3).sell) },
      { key: 'sell2', kind: 'sell', k: 2, value: L(2).sell, label: '2 SD Sell - ' + f2(L(2).sell) },
      { key: 'sell1', kind: 'sell', k: 1, value: L(1).sell, label: '1 SD Sell - ' + f2(L(1).sell) },
      { key: 'open', kind: 'open', k: 0, value: spot, label: 'Open (Spot) - ' + f2(spot) },
      { key: 'buy1', kind: 'buy', k: 1, value: L(1).buy, label: '1 SD Buy - ' + f2(L(1).buy) },
      { key: 'buy2', kind: 'buy', k: 2, value: L(2).buy, label: '2 SD Buy - ' + f2(L(2).buy) },
      { key: 'buy3', kind: 'buy', k: 3, value: L(3).buy, label: '3 SD Buy - ' + f2(L(3).buy) },
    ];
    return { spot, sd1, levels, chartLines };
  }

  /** ราคา price อยู่ที่กี่ SD จาก Spot (บวก = เหนือ Spot) */
  function position(price, res) {
    if (!res || !isFinite(price) || !(res.sd1 > 0)) return null;
    const z = (price - res.spot) / res.sd1;
    const a = Math.abs(z);
    const side = z >= 0 ? 'บน (ฝั่ง Sell)' : 'ล่าง (ฝั่ง Buy)';
    let text;
    if (a < 0.05) text = 'ใกล้ราคา Spot';
    else if (a < 1) text = 'อยู่ภายใน 1SD ' + side;
    else if (a < 2) text = 'อยู่ระหว่าง 1SD–2SD ' + side;
    else if (a < 3) text = 'อยู่ระหว่าง 2SD–3SD ' + side;
    else text = 'เกิน 3SD ' + side;
    return { z, text, diff: price - res.spot };
  }

  /** กำไร/ขาดทุนของเทรดที่ปิดแล้ว  side: 'BUY' | 'SELL' */
  function tradePnL(t) {
    const exit = parseNum(t.exit);
    if (isNaN(exit)) return null;
    const dir = t.side === 'SELL' ? -1 : 1;
    const points = (exit - t.entry) * dir;
    const mult = t.multiplier === undefined ? 100 : t.multiplier;
    return { points, usd: points * t.lots * mult };
  }

  /** สรุปสถิติสำหรับ Dashboard */
  function summarize(snapshots, trades) {
    const out = { snapCount: snapshots.length, avgIV: null, avgSD: null, hit: null, trades: null };
    if (snapshots.length) {
      out.avgIV = snapshots.reduce((s, x) => s + x.inputs.iv, 0) / snapshots.length;
      out.avgSD = snapshots.reduce((s, x) => s + compute(x.inputs).sd1, 0) / snapshots.length;
    }
    // อัตราที่ราคาจริงแตะระดับ SD (เฉพาะวันที่ผู้ใช้กรอก High/Low จริงไว้)
    const withActual = snapshots.filter(x => x.actual && isFinite(x.actual.high) && isFinite(x.actual.low));
    if (withActual.length) {
      const hit = { days: withActual.length, sell: [0, 0, 0], buy: [0, 0, 0], inside1: 0 };
      withActual.forEach(x => {
        const r = compute(x.inputs);
        r.levels.forEach((l, i) => {
          if (x.actual.high >= l.sell) hit.sell[i]++;
          if (x.actual.low <= l.buy) hit.buy[i]++;
        });
        if (x.actual.high < r.levels[0].sell && x.actual.low > r.levels[0].buy) hit.inside1++;
      });
      out.hit = hit;
    }
    const closed = trades.map(t => ({ t, p: tradePnL(t) })).filter(x => x.p);
    if (trades.length) {
      const wins = closed.filter(x => x.p.points > 0).length;
      out.trades = {
        total: trades.length,
        open: trades.length - closed.length,
        closed: closed.length,
        wins,
        winRate: closed.length ? wins / closed.length : null,
        points: closed.reduce((s, x) => s + x.p.points, 0),
        usd: closed.reduce((s, x) => s + x.p.usd, 0),
      };
    }
    return out;
  }

  return { parseNum, validate, compute, position, tradePnL, summarize, f2 };
});
