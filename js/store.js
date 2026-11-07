/* store.js — เก็บข้อมูลในเครื่อง (localStorage) ทำงานได้แม้ออฟไลน์
 * ทุก record มี id, updatedAt (ms), deleted (soft delete เพื่อให้การลบซิงค์ข้าม Google Sheets ได้) */
(function (root) {
  'use strict';
  const KEY = 'gta.v1';
  const DEFAULTS = {
    settings: { theme: 'light', fontScale: 1.15, daysPerYear: 365, multiplier: 100, apiUrl: '', token: '', autoSync: true },
    snapshots: [], journal: [], errors: [], lastPush: 0, lastSync: 0,
  };
  const clone = o => JSON.parse(JSON.stringify(o));
  let st = clone(DEFAULTS);
  let persistent = true;
  let listeners = [];

  function uid() {
    if (root.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  function init() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        try {
          const o = JSON.parse(raw);
          st = Object.assign(clone(DEFAULTS), o);
          st.settings = Object.assign({}, DEFAULTS.settings, o.settings || {});
          ['snapshots', 'journal', 'errors'].forEach(k => { if (!Array.isArray(st[k])) st[k] = []; });
        } catch (parseErr) {
          // ข้อมูลเสีย: เก็บสำเนาไว้ก่อน ไม่ทับทิ้ง
          try { localStorage.setItem(KEY + '.corrupt.' + Date.now(), raw); } catch (_) { /* ignore */ }
          st = clone(DEFAULTS);
          logError('init', new Error('ข้อมูลในเครื่องเสียหาย — เก็บสำเนาไว้และเริ่มใหม่'));
          return { corrupt: true };
        }
      }
    } catch (e) {
      persistent = false; // เช่น Private mode
    }
    return {};
  }

  function persist() {
    try {
      localStorage.setItem(KEY, JSON.stringify(st));
      persistent = true;
    } catch (e) {
      persistent = false;
      listeners.forEach(f => f('persist-failed', e));
    }
  }
  const onEvent = f => listeners.push(f);
  const isPersistent = () => persistent;

  const settings = () => st.settings;
  function setSettings(patch) { Object.assign(st.settings, patch); persist(); }

  const kinds = { snapshots: 1, journal: 1 };
  function list(kind, includeDeleted) {
    const a = st[kind].filter(r => includeDeleted || !r.deleted);
    return a.sort((x, y) => (y.date || '').localeCompare(x.date || '') || (y.createdAt || 0) - (x.createdAt || 0));
  }
  const get = (kind, id) => st[kind].find(r => r.id === id) || null;

  function put(kind, rec) {
    if (!kinds[kind]) throw new Error('kind ไม่ถูกต้อง: ' + kind);
    const now = Date.now();
    rec.id = rec.id || uid();
    rec.updatedAt = now;
    const i = st[kind].findIndex(r => r.id === rec.id);
    if (i >= 0) { rec.createdAt = st[kind][i].createdAt || now; st[kind][i] = rec; }
    else { rec.createdAt = rec.createdAt || now; st[kind].push(rec); }
    persist();
    return rec;
  }
  function remove(kind, id) {
    const r = get(kind, id);
    if (!r) return;
    r.deleted = true; r.updatedAt = Date.now();
    persist();
  }

  /** รวมข้อมูลจากภายนอก (Google Sheets / ไฟล์สำรอง) — ใครแก้ล่าสุดชนะ */
  function merge(kind, remote) {
    let changed = 0;
    (remote || []).forEach(r => {
      if (!r || !r.id || typeof r.updatedAt !== 'number') return;
      const i = st[kind].findIndex(x => x.id === r.id);
      if (i < 0) { st[kind].push(r); changed++; }
      else if (r.updatedAt > st[kind][i].updatedAt) { st[kind][i] = r; changed++; }
    });
    if (changed) persist();
    return changed;
  }
  const dirty = kind => st[kind].filter(r => r.updatedAt > st.lastPush);
  function markPushed(ts) { st.lastPush = Math.max(st.lastPush, ts); st.lastSync = Date.now(); persist(); }
  const syncInfo = () => ({ lastPush: st.lastPush, lastSync: st.lastSync, pending: dirty('snapshots').length + dirty('journal').length });

  function logError(ctx, err) {
    const msg = err && err.message ? err.message : String(err);
    st.errors.unshift({ t: new Date().toISOString(), ctx, msg: msg.slice(0, 500) });
    st.errors.length = Math.min(st.errors.length, 50);
    persist();
  }
  const errors = () => st.errors;
  function clearErrors() { st.errors = []; persist(); }

  function exportAll() {
    return {
      app: 'gold-trading-assistant', version: 1, exportedAt: new Date().toISOString(),
      snapshots: st.snapshots, journal: st.journal,
    };
  }
  function importAll(o) {
    if (!o || o.app !== 'gold-trading-assistant' || !Array.isArray(o.snapshots) || !Array.isArray(o.journal)) {
      throw new Error('ไฟล์นี้ไม่ใช่ไฟล์สำรองของ Gold Trading Assistant');
    }
    return { snapshots: merge('snapshots', o.snapshots), journal: merge('journal', o.journal) };
  }
  function wipe() { st = clone(DEFAULTS); persist(); }

  root.Store = { init, uid, settings, setSettings, list, get, put, remove, merge, dirty, markPushed, syncInfo,
    logError, errors, clearErrors, exportAll, importAll, wipe, onEvent, isPersistent };
})(typeof self !== 'undefined' ? self : this);
