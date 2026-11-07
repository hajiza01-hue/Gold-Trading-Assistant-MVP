/* sync.js — เชื่อม Google Sheets / Google Drive ผ่าน Apps Script Web App (ฟรี)
 * ใช้ POST แบบ text/plain เพื่อไม่ให้เบราว์เซอร์ส่ง preflight (Apps Script ไม่รองรับ OPTIONS) */
(function (root) {
  'use strict';
  let busy = false;

  const FRIENDLY = {
    AUTH: 'รหัสลับ (Token) ไม่ตรงกับที่ตั้งไว้ใน Apps Script',
    SECRET_NOT_SET: 'ยังไม่ได้เปลี่ยนรหัสลับ SECRET ในไฟล์ Code.gs',
    BAD_REQUEST: 'คำขอไม่ถูกต้อง',
    TOO_LARGE: 'ไฟล์ใหญ่เกินไป',
  };

  const configured = () => { const s = Store.settings(); return !!(s.apiUrl && s.token); };

  async function call(payload, timeoutMs) {
    const s = Store.settings();
    if (!configured()) throw new Error('ยังไม่ได้ตั้งค่าการเชื่อมต่อ Google (ไปที่แท็บ ตั้งค่า)');
    if (!/^https:\/\/script\.google\.com\/(a\/[^/]+\/)?macros\/s\/[^/]+\/exec$/.test(s.apiUrl.trim())) {
      throw new Error('URL ไม่ถูกต้อง ต้องขึ้นต้น https://script.google.com/macros/s/ และลงท้าย /exec');
    }
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs || 30000);
    try {
      let r;
      try {
        r = await fetch(s.apiUrl.trim(), {
          method: 'POST', redirect: 'follow', signal: ctl.signal,
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify(Object.assign({ token: s.token.trim() }, payload)),
        });
      } catch (e) {
        if (e.name === 'AbortError') throw new Error('Google ตอบช้าเกินไป ลองใหม่อีกครั้ง');
        throw new Error('เชื่อมต่อไม่ได้ — ตรวจอินเทอร์เน็ต หรือการ Deploy เป็น "Anyone"');
      }
      if (!r.ok) throw new Error('Google ตอบกลับผิดปกติ (' + r.status + ')');
      let j;
      try { j = await r.json(); } catch (e) {
        throw new Error('คำตอบจาก Google ไม่ถูกต้อง — ตรวจว่าใช้ URL ที่ลงท้าย /exec และ Deploy เป็น "Anyone"');
      }
      if (!j.ok) throw new Error(FRIENDLY[j.error] || ('Google แจ้งข้อผิดพลาด: ' + j.error));
      return j;
    } finally { clearTimeout(timer); }
  }

  const ping = () => call({ action: 'ping' }, 15000);

  /** ส่งข้อมูลที่เปลี่ยน + ดึงข้อมูลรวมกลับมา */
  async function syncNow() {
    if (busy) return { skipped: true };
    busy = true;
    try {
      const snaps = Store.dirty('snapshots'), jr = Store.dirty('journal');
      const sentMax = Math.max(0, ...snaps.map(r => r.updatedAt), ...jr.map(r => r.updatedAt));
      const res = await call({ action: 'sync', snapshots: snaps, journal: jr });
      const a = Store.merge('snapshots', res.snapshots), b = Store.merge('journal', res.journal);
      Store.markPushed(sentMax);
      return { pushed: snaps.length + jr.length, pulled: a + b };
    } catch (e) {
      Store.logError('sync', e);
      throw e;
    } finally { busy = false; }
  }

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result).split(',')[1]);
      fr.onerror = () => reject(new Error('อ่านไฟล์ไม่สำเร็จ'));
      fr.readAsDataURL(blob);
    });
  }

  /** อัปโหลดไฟล์ขึ้น Google Drive (โฟลเดอร์ "Gold Trading Assistant") */
  async function uploadToDrive(name, blob) {
    try {
      const data = await blobToBase64(blob);
      return await call({ action: 'upload', name, mime: blob.type || 'application/octet-stream', data }, 60000);
    } catch (e) { Store.logError('drive', e); throw e; }
  }

  root.Sync = { configured, ping, syncNow, uploadToDrive };
})(typeof self !== 'undefined' ? self : this);
