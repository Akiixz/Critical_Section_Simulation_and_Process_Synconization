'use strict';

/* =====================================================================
   Critical Section & Process Synchronization — Demo v2
   ---------------------------------------------------------------------
   JavaScript บนเบราว์เซอร์เป็น single-thread จึงจำลองการสลับ thread ด้วย
   async/await: ทุก `await` คือจุดที่ "OS สลับงาน" ได้ (yield point)
   Mutex / Semaphore ด้านล่างเป็นของจริงที่ทำงานตามหลักการเดียวกับ OS
   (มีคิวรอแบบ FIFO) ไม่ได้เป็นแค่ภาพเคลื่อนไหวหลอกๆ
   ===================================================================== */

/* ---------------------------------------------------------------- helpers */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const h = (tag, cls = '', html = '') => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
};
const rand = (a, b) => a + Math.random() * (b - a);
const fmt = (n) => Number(n).toLocaleString('en-US');
const secs1 = (ms) => (ms / 1000).toFixed(1);
const clampInt = (v, lo, hi, d) => {
  let x = parseInt(v, 10);
  if (Number.isNaN(x)) x = d;
  return Math.min(hi, Math.max(lo, x));
};
const mmss = (ms) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

class Abort extends Error {}

/* ------------------------------------------------------------------ Clock
   นาฬิกาจำลองของการรัน 1 ครั้ง: หยุดชั่วคราวได้, ยกเลิกได้, ปรับความเร็วสดได้ */
class Clock {
  constructor() {
    this.t = 0;                 // เวลาจำลอง (ms) — เดินเฉพาะตอนไม่ pause
    this.speed = 1;
    this.paused = false;
    this.aborted = false;
    this.stopped = false;
    this.waiters = [];
    this.anims = new Set();
    this.ticks = new Set();
    this._last = 0;
    this._raf = 0;
  }
  start() {
    this._last = performance.now();
    const loop = (now) => {
      if (this.stopped) return;
      const dt = Math.min(100, Math.max(0, now - this._last));
      this._last = now;
      if (!this.paused) {
        this.t += dt;
        if (this.waiters.length) {
          const due = [];
          const rest = [];
          for (const w of this.waiters) (w.at <= this.t ? due : rest).push(w);
          this.waiters = rest;
          due.forEach((w) => w.fire());
        }
      }
      this.ticks.forEach((fn) => fn(this.t));
      if (!this.stopped) this._raf = requestAnimationFrame(loop);
    };
    this._raf = requestAnimationFrame(loop);
  }
  sleep(ms) {
    return new Promise((res, rej) => {
      if (this.aborted) return rej(new Abort());
      this.waiters.push({
        at: this.t + ms / this.speed,
        fire: () => (this.aborted ? rej(new Abort()) : res()),
        rej,
      });
    });
  }
  check() { if (this.aborted) throw new Abort(); }
  wrap(p) { return p.then((v) => { this.check(); return v; }); }
  pause() { this.paused = true; this.anims.forEach((a) => a.pause()); }
  resume() { this.paused = false; this._last = performance.now(); this.anims.forEach((a) => a.play()); }
  stop() { this.stopped = true; cancelAnimationFrame(this._raf); }
  abort() {
    if (this.aborted) return;
    this.aborted = true;
    this.stop();
    this.anims.forEach((a) => a.cancel());
    this.anims.clear();
    const ws = this.waiters;
    this.waiters = [];
    ws.forEach((w) => w.rej(new Abort()));
  }
}

/* ------------------------------------------------------- Mutex / Semaphore
   ทั้งคู่มีคิวรอแบบ FIFO (ใครมาก่อนได้ก่อน = Bounded Waiting) */
class Mutex {
  constructor(onChange) { this.holder = null; this.queue = []; this.onChange = onChange || (() => {}); }
  acquire(id) {
    return new Promise((res) => {
      if (this.holder === null) { this.holder = id; res(); }
      else this.queue.push({ id, res });
      this.onChange();
    });
  }
  release() {
    const next = this.queue.shift();
    if (next) { this.holder = next.id; next.res(); }
    else this.holder = null;
    this.onChange();
  }
}

class Sem {
  constructor(n, onChange) { this.count = n; this.queue = []; this.onChange = onChange || (() => {}); }
  acquire(id) {
    return new Promise((res) => {
      if (this.count > 0) { this.count--; res(); }
      else this.queue.push({ id, res });
      this.onChange();
    });
  }
  release() {
    const next = this.queue.shift();
    if (next) next.res();
    else this.count++;
    this.onChange();
  }
}

/* ------------------------------------------------------------ flying chip
   ลูกกลมที่บินจาก element หนึ่งไปอีก element หนึ่ง (แสดงข้อมูลที่ย้ายที่) */
function fly(clock, arena, fromEl, toEl, html, cls, ms) {
  clock.check();
  const ar = arena.getBoundingClientRect();
  const fr = fromEl.getBoundingClientRect();
  const tr = toEl.getBoundingClientRect();
  const x1 = fr.left + fr.width / 2 - ar.left;
  const y1 = fr.top + fr.height / 2 - ar.top;
  const x2 = tr.left + tr.width / 2 - ar.left;
  const y2 = tr.top + tr.height / 2 - ar.top;
  const chip = h('div', 'chip ' + cls, html);
  arena.appendChild(chip);
  const a = chip.animate(
    [
      { transform: `translate(${x1}px,${y1}px) translate(-50%,-50%) scale(.75)`, opacity: 0.2 },
      { opacity: 1, offset: 0.15 },
      { transform: `translate(${x2}px,${y2}px) translate(-50%,-50%) scale(1)`, opacity: 1 },
    ],
    { duration: ms / clock.speed, easing: 'cubic-bezier(.45,.05,.25,1)', fill: 'forwards' }
  );
  clock.anims.add(a);
  if (clock.paused) a.pause();
  return a.finished.catch(() => {}).then(() => {
    clock.anims.delete(a);
    chip.remove();
    clock.check();
  });
}

/* --------------------------------------- yield แบบสุ่ม (ใช้ใน Stress test)
   microtask = ต่อคิวทันที, macrotask = ให้ thread อื่น/หน้าจอได้ทำงานก่อน
   สุ่มผสมกัน ทำให้ผลลัพธ์ของฝั่งไม่มี Lock "ไม่เท่ากันทุกครั้ง" เหมือนของจริง */
const macroQ = [];
const mc = new MessageChannel();
mc.port1.onmessage = () => { const r = macroQ.shift(); if (r) r(); };
const macroYield = () => new Promise((r) => { macroQ.push(r); mc.port2.postMessage(0); });
const yieldPoint = async () => {
  // สุ่มจำนวนครั้งที่ถูก "สลับงาน" 0–3 ครั้ง (บางครั้งไม่โดนสลับเลย)
  const n = Math.random() < 0.35 ? 0 : 1 + Math.floor(Math.random() * 3);
  for (let i = 0; i < n; i++) await (Math.random() < 0.5 ? Promise.resolve() : macroYield());
};

/* --------------------------------------------------------- canvas colors */
const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
let COL = null;
const colors = () => COL || (COL = {
  wait: cssVar('--red'), cs: cssVar('--amber'), rem: '#2a3048', done: cssVar('--teal'),
  dim: cssVar('--dim'), faint: cssVar('--faint'), grid: '#222844', lane: '#151a2b',
});

/* ====================================================================
   บันทึกผลการรัน
   ==================================================================== */
const History = {
  rows: [],
  add(row) {
    this.rows.unshift({ ...row, time: new Date().toLocaleTimeString('th-TH', { hour12: false }) });
    this.rows = this.rows.slice(0, 40);
    this.render();
  },
  render() {
    const tb = $('#hist-body');
    if (!this.rows.length) {
      tb.innerHTML = '<tr><td class="empty" colspan="7">ยังไม่มีข้อมูล — กด ▶ run เพื่อเริ่มบันทึกผล</td></tr>';
      return;
    }
    tb.innerHTML = this.rows.map((r) => `
      <tr class="${r.ok ? 'pass' : 'fail'}">
        <td>${r.time}</td><td>${r.demo}</td><td>${r.mode}</td><td>${r.config}</td>
        <td>${r.result}</td><td>${r.secs}</td><td>${r.ok ? '✓ ถูกต้อง' : '✗ ผิดพลาด'}</td>
      </tr>`).join('');
  },
  csv() {
    const esc = (s) => `"${String(s).replace(/"/g, '""')}"`;
    const head = ['เวลา', 'การจำลอง', 'โหมด', 'ตั้งค่า', 'ผลลัพธ์', 'ใช้เวลา', 'สถานะ'];
    const lines = [head.map(esc).join(',')];
    [...this.rows].reverse().forEach((r) =>
      lines.push([r.time, r.demo, r.mode, r.config, r.result, r.secs, r.ok ? 'ถูกต้อง' : 'ผิดพลาด'].map(esc).join(',')));
    return lines.join('\n');
  },
  async copy() {
    const msg = $('#hist-msg');
    const text = this.csv();
    try {
      await navigator.clipboard.writeText(text);
    } catch (e) {
      const ta = h('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    msg.textContent = 'คัดลอกแล้ว ✓';
    setTimeout(() => (msg.textContent = ''), 1800);
  },
};

/* ====================================================================
   STAGE 1 : Shared Counter  (1 ฝั่ง = 1 โหมด: มี/ไม่มี Lock)
   ==================================================================== */
const CARD_CLASS = { idle: 's-idle', wait: 's-wait', cs: 's-cs', rem: 's-idle', done: 's-done' };
const STRESS_LABEL = { idle: 'พร้อม', wait: 'รอคิว', cs: 'ใน CS', rem: 'วนต่อ', done: 'เสร็จ' };
const CT = { start: [0, 700], read: 450, calc: 550, gap: 250, write: 450, rem: [300, 1800] };

class CounterStage {
  constructor(host, sync) {
    this.sync = sync;
    this.kind = sync ? 'sync' : 'nosync';
    this.cfg = null;
    this.c = null;
    this.lastT = 0;
    this.dirty = false;
    this.done = false;
    this.onResult = null;

    this.root = h('section', `stage ${sync ? 'is-sync' : 'is-nosync'}`);
    this.root.dataset.kind = this.kind;
    const lockHtml = sync
      ? `<div class="lock-ico" data-r="lockIco">🔓</div>
         <div class="lock-txt" data-r="lockTxt">MUTEX ว่าง</div>
         <div class="lock-sub" data-r="lockSub">ใครมาก่อนเข้าก่อน</div>
         <div class="lock-q" data-r="lockQ"></div>`
      : `<div class="lock-ico">🚪</div>
         <div class="lock-txt">ไม่มี Lock</div>
         <div class="lock-sub">ใครจะเข้าก็ได้ ทุกเมื่อ</div>`;
    this.root.innerHTML = `
      <header class="stage-head">
        <span class="badge">${sync ? '✅ มี Lock (Mutex)' : '❌ ไม่มี Lock'}</span>
        <span class="stage-sub">${sync ? 'เข้า Critical Section ได้ทีละ 1 Thread' : 'ทุก Thread เข้าไปแก้ค่าพร้อมกันได้'}</span>
      </header>
      <div class="narration" data-r="narr"></div>
      <div class="arena" data-r="arena">
        <div class="arena-top">
          <div class="counter-box" data-r="cbox">
            <div class="lbl">SHARED COUNTER</div>
            <div class="cval" data-r="cval">0</div>
            <div class="csub" data-r="csub">ควรเป็น 0</div>
          </div>
          <div class="lock-box ${sync ? 'free' : 'none'}" data-r="lock">${lockHtml}</div>
        </div>
        <div class="threads-row" data-r="threads"></div>
      </div>
      <div class="lanes-wrap" data-r="lanesWrap">
        <div class="lanes-head">
          <span class="ttl">TIMELINE — ใครอยู่ใน Critical Section ตอนไหน</span>
          <span class="legend">
            <span class="lg"><i style="background:var(--red)"></i>รอคิว</span>
            <span class="lg"><i style="background:var(--amber)"></i>อยู่ใน CS</span>
            <span class="lg"><i style="background:var(--teal)"></i>เสร็จ</span>
            <span class="lg"><i style="background:rgba(255,93,93,.35);border:1px solid var(--red)"></i>ชนกัน</span>
          </span>
        </div>
        <canvas class="lanes" data-r="lanes"></canvas>
      </div>
      <div class="tiles">
        <div class="tile" data-r="tActual"><label>ค่าจริง (actual)</label><b data-r="vActual">0</b></div>
        <div class="tile"><label>ควรเป็น</label><b data-r="vExpected">0</b><small>เท่าจำนวนครั้งที่เขียนเสร็จ</small></div>
        <div class="tile" data-r="tLost"><label>หายไป (lost)</label><b data-r="vLost">0</b></div>
        <div class="tile" data-r="tMax"><label>ใน CS พร้อมกันสูงสุด</label><b data-r="vMax">0</b><small>ต้องไม่เกิน 1</small></div>
      </div>
      <div class="result" data-r="result"></div>
      <div class="log" data-r="log"></div>`;
    host.appendChild(this.root);
    this.r = {};
    $$('[data-r]', this.root).forEach((e) => (this.r[e.dataset.r] = e));
  }

  /* ---------- state / ui reset ---------- */
  clear(cfg) {
    this.cfg = cfg;
    this.c = null;
    this.done = false;
    this.dirty = false;
    this.counter = 0;
    this.writes = 0;
    this.inCS = 0;
    this.maxCS = 0;
    this.lastT = 0;
    this.lanes = Array.from({ length: cfg.n }, () => []);
    this.tstate = [];
    this.prog = [];
    this.mutex = new Mutex(() => { this.dirty = true; });

    this.r.threads.innerHTML = '';
    this.cards = [];
    for (let i = 0; i < cfg.n; i++) {
      const root = h('div', 'tcard s-idle');
      root.innerHTML = `<div class="tid">T${i}</div><div class="tstate">พร้อม</div>
        <div class="treg" ${cfg.visual ? '' : 'style="display:none"'}><span>reg</span><b>–</b></div>
        <div class="tbar"><i></i></div>`;
      this.r.threads.appendChild(root);
      this.cards.push({ root, state: $('.tstate', root), reg: $('.treg b', root), bar: $('.tbar i', root), st: '', pct: -1 });
    }
    this.r.lanesWrap.style.display = cfg.visual ? '' : 'none';
    this.r.cval.textContent = '0';
    this.r.csub.textContent = 'ควรเป็น 0';
    this.r.log.innerHTML = '';
    this.setResult('', 'ยังไม่ได้รัน — กด ▶ run');
    this.say(this.sync
      ? 'ทุก Thread ต้อง <b>ขอ Mutex ก่อน</b> จึงจะเข้าไปอ่าน-แก้-เขียน Counter ได้ (ทีละ 1 คน)'
      : 'ไม่มีการล็อก — ทุก Thread <b>อ่านและเขียน Counter พร้อมกัน</b>ได้ ดูว่าจะเกิดอะไรขึ้น');
    this.renderTiles();
    this.renderLock();
    this.draw(0);
  }

  say(msg, kind = '') { this.r.narr.className = 'narration ' + kind; this.r.narr.innerHTML = `<span>${msg}</span>`; }
  setResult(kind, text) { this.r.result.className = 'result ' + kind; this.r.result.textContent = text; }
  log(msg, cls = '') {
    const d = h('div', cls);
    d.textContent = msg;
    this.r.log.appendChild(d);
    while (this.r.log.childElementCount > 300) this.r.log.firstChild.remove();
    this.r.log.scrollTop = this.r.log.scrollHeight;
  }

  /* ---------- rendering ---------- */
  renderTiles() {
    const r = this.r;
    const lost = Math.max(0, this.writes - this.counter);
    r.vActual.textContent = fmt(this.counter);
    r.vExpected.textContent = fmt(this.writes);
    r.vLost.textContent = fmt(lost);
    r.tLost.className = 'tile' + (lost > 0 ? ' bad' : this.writes > 0 ? ' ok' : '');
    r.vMax.textContent = this.maxCS;
    r.tMax.className = 'tile' + (this.maxCS > 1 ? ' bad' : this.maxCS === 1 ? ' ok' : '');
  }

  renderLock() {
    this.dirty = false;
    if (!this.sync) return;
    const m = this.mutex;
    const r = this.r;
    if (m.holder === null) {
      r.lock.className = 'lock-box free';
      r.lockIco.textContent = '🔓';
      r.lockTxt.textContent = 'MUTEX ว่าง';
      r.lockSub.textContent = 'ใครมาก่อนเข้าก่อน';
    } else {
      r.lock.className = 'lock-box held';
      r.lockIco.textContent = '🔒';
      r.lockTxt.textContent = `ถือกุญแจ: T${m.holder}`;
      r.lockSub.textContent = m.queue.length ? `รอคิว ${m.queue.length} คน` : 'ไม่มีคนรอ';
    }
    r.lockQ.innerHTML = m.queue.map((q) => `<span class="qchip">T${q.id}</span>`).join('');
    this.cards.forEach((cd, i) => cd.root.classList.toggle('holder', m.holder === i));
  }

  setCard(i, cls, label) {
    const cd = this.cards[i];
    cd.root.className = 'tcard ' + cls + (this.sync && this.mutex.holder === i ? ' holder' : '');
    cd.state.textContent = label;
  }

  renderStress() {
    const r = this.r;
    r.cval.textContent = fmt(this.counter);
    r.csub.textContent = `ควรเป็น ${fmt(this.writes)}`;
    this.renderTiles();
    this.cards.forEach((cd, i) => {
      const st = this.tstate[i] || 'idle';
      if (cd.st !== st) {
        cd.st = st;
        cd.root.className = 'tcard ' + CARD_CLASS[st];
        cd.state.textContent = STRESS_LABEL[st];
      }
      const pct = Math.round(((this.prog[i] || 0) / this.cfg.per) * 100);
      if (cd.pct !== pct) { cd.pct = pct; cd.bar.style.width = pct + '%'; }
    });
  }

  updateCounter(kind, lostNow) {
    const r = this.r;
    r.cval.textContent = fmt(this.counter);
    r.csub.textContent = `ควรเป็น ${fmt(this.writes)}`;
    const box = r.cbox;
    box.classList.remove('pulse-ok', 'pulse-bad');
    void box.offsetWidth;
    box.classList.add(kind === 'bad' ? 'pulse-bad' : 'pulse-ok');
    if (lostNow > 0) {
      const f = h('div', 'float-neg', `−${lostNow}`);
      box.appendChild(f);
      setTimeout(() => f.remove(), 1400);
    }
    this.renderTiles();
  }

  /* ---------- timeline (swimlane) ---------- */
  laneTo(i, s) {
    const L = this.lanes[i];
    const t = this.c.t;
    const last = L[L.length - 1];
    if (last && last.t1 === null) last.t1 = t;
    L.push({ s, t0: t, t1: null });
  }

  overlaps(now) {
    const ev = [];
    this.lanes.forEach((L) => L.forEach((s) => {
      if (s.s === 'cs') { ev.push([s.t0, 1]); ev.push([s.t1 === null ? now : s.t1, -1]); }
    }));
    ev.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const out = [];
    let c = 0;
    let start = 0;
    for (const [t, d] of ev) {
      const prev = c;
      c += d;
      if (prev < 2 && c >= 2) start = t;
      if (prev >= 2 && c < 2 && t > start) out.push([start, t, prev]);
    }
    return out;
  }

  redraw() { this.draw(this.lastT); }

  draw(now) {
    const cv = this.r.lanes;
    if (!cv || !this.cfg || !this.cfg.visual) return;
    const W = cv.clientWidth;
    if (!W) return;
    const n = this.cfg.n;
    const rowH = 25;
    const top = 4;
    const axisH = 20;
    const H = top + n * rowH + axisH;
    const dpr = window.devicePixelRatio || 1;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
      cv.width = Math.round(W * dpr);
      cv.height = Math.round(H * dpr);
      cv.style.height = H + 'px';
    }
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const C = colors();
    const x0 = 30;
    const x1 = W - 6;
    const span = Math.max(8000, now * 1.04);
    const X = (t) => x0 + (t / span) * (x1 - x0);

    // เส้นกริดเวลา
    g.font = '10px "IBM Plex Mono", ui-monospace, monospace';
    g.textBaseline = 'middle';
    const stepS = span > 40000 ? 10 : span > 20000 ? 5 : span > 10000 ? 2 : 1;
    for (let s = 0; s * 1000 <= span; s += stepS) {
      const x = X(s * 1000);
      g.strokeStyle = C.grid;
      g.beginPath(); g.moveTo(x, top); g.lineTo(x, top + n * rowH); g.stroke();
      g.fillStyle = C.faint;
      g.textAlign = 'center';
      g.fillText(s + 's', x, top + n * rowH + 11);
    }
    // lane
    for (let i = 0; i < n; i++) {
      const y = top + i * rowH;
      g.fillStyle = C.lane;
      g.fillRect(x0, y + 2, x1 - x0, rowH - 4);
      g.fillStyle = C.dim;
      g.textAlign = 'left';
      g.font = '600 11px "IBM Plex Mono", ui-monospace, monospace';
      g.fillText('T' + i, 4, y + rowH / 2);
      (this.lanes[i] || []).forEach((s) => {
        const a = X(s.t0);
        const b = X(s.t1 === null ? now : s.t1);
        if (b - a < 0.5) return;
        g.fillStyle = C[s.s] || C.rem;
        g.globalAlpha = s.s === 'rem' ? 0.7 : 1;
        g.fillRect(a, y + 4, Math.max(1, b - a), rowH - 8);
        g.globalAlpha = 1;
      });
    }
    // ช่วงที่ชนกัน
    this.overlaps(now).forEach(([a, b, k]) => {
      const xa = X(a);
      const xb = X(b);
      g.fillStyle = 'rgba(255,93,93,.22)';
      g.fillRect(xa, top, Math.max(2, xb - xa), n * rowH);
      g.strokeStyle = C.wait;
      g.lineWidth = 1;
      g.strokeRect(xa + 0.5, top + 0.5, Math.max(2, xb - xa) - 1, n * rowH - 1);
      if (xb - xa > 34) {
        g.fillStyle = '#fff';
        g.font = '700 10px "IBM Plex Mono", ui-monospace, monospace';
        g.textAlign = 'center';
        g.fillText('ชนกัน ×' + k, (xa + xb) / 2, top + 9);
      }
    });
    // เส้นเวลาปัจจุบัน
    if (!this.done) {
      g.strokeStyle = '#ffffff55';
      g.beginPath(); g.moveTo(X(now), top); g.lineTo(X(now), top + n * rowH); g.stroke();
    }
  }

  /* ---------- run ---------- */
  tick(t) {
    this.lastT = t;
    if (this.dirty) this.renderLock();
    if (this.done) return;
    if (this.cfg.visual) this.draw(t);
    else this.renderStress();
  }

  start(clock, cfg) {
    this.clear(cfg);
    this.c = clock;
    this.wall0 = performance.now();
    clock.ticks.add((t) => this.tick(t));
    this.setResult('', 'กำลังรัน…');
    if (!cfg.visual) this.say(`⚡ Stress test — ทุก Thread บวก Counter คนละ ${fmt(cfg.per)} ครั้ง แล้วดูผลรวมตอนจบ`);
    const jobs = [];
    for (let i = 0; i < cfg.n; i++) jobs.push(cfg.visual ? this.visualThread(i) : this.stressThread(i));
    return Promise.all(jobs).then(() => { if (!clock.aborted) this.finish(); });
  }

  enterCS(i) {
    this.inCS++;
    if (this.inCS > this.maxCS) this.maxCS = this.inCS;
    this.laneTo(i, 'cs');
    this.renderTiles();
  }

  /* Visual: ช้า เห็นทุกขั้น + อนิเมชันข้อมูลวิ่ง */
  async visualThread(i) {
    const c = this.c;
    const rounds = this.cfg.per;
    const card = this.cards[i];
    await c.sleep(rand(CT.start[0], CT.start[1]));
    for (let k = 0; k < rounds; k++) {
      // ---- Entry Section ----
      if (this.sync) {
        this.setCard(i, 's-wait', 'รอคิวเข้า CS');
        this.laneTo(i, 'wait');
        await c.wrap(this.mutex.acquire(i));
      }
      this.enterCS(i);

      // ---- READ ----
      const temp = this.counter;
      this.setCard(i, 's-cs', 'READ อ่านค่า');
      this.say(`<b>T${i}</b> อ่านค่า Counter = <b>${temp}</b> เก็บไว้ใน reg`);
      this.log(`T${i} READ  counter = ${temp}`, 'dim');
      await fly(c, this.r.arena, this.r.cbox, card.root, `<small>READ</small>${temp}`, 'read', CT.read);
      card.reg.textContent = temp;

      // ---- คำนวณ (จุดที่ thread อื่นแทรกได้ถ้าไม่มี Lock) ----
      this.setCard(i, 's-cs', 'คำนวณ +1');
      await c.sleep(CT.calc);
      const nv = temp + 1;
      card.reg.textContent = nv;
      await c.sleep(CT.gap);

      // ---- WRITE ----
      this.setCard(i, 's-cs', 'WRITE เขียนค่า');
      await fly(c, this.r.arena, card.root, this.r.cbox, `<small>WRITE</small>${nv}`, 'write', CT.write);
      const cur = this.counter;
      const stale = cur !== temp;
      this.counter = nv;
      this.writes++;
      if (stale) {
        const lostNow = Math.max(0, cur - temp);
        this.updateCounter('bad', lostNow);
        const why = cur > temp
          ? `ค่าที่คนอื่นเพิ่มไว้ ${cur - temp} ครั้ง <b>หายไป</b>`
          : 'Counter ถูกแก้ระหว่างทาง แล้วโดนเขียนทับ';
        this.say(`⚠ <b>T${i}</b> เขียน ${nv} ทับ! ตอนอ่านเห็น ${temp} แต่ตอนเขียน Counter เป็น ${cur} แล้ว → ${why}`, 'bad');
        this.log(`T${i} WRITE ${nv}  ⚠ LOST UPDATE (อ่านไว้ ${temp}, ตอนเขียนเป็น ${cur})`, 'bad');
      } else {
        this.updateCounter('ok', 0);
        this.say(`<b>T${i}</b> เขียน Counter = <b>${nv}</b> ✓`, 'ok');
        this.log(`T${i} WRITE ${nv}`, 'ok');
      }

      // ---- Exit Section ----
      this.inCS--;
      if (this.sync) this.mutex.release();
      card.reg.textContent = '–';
      this.setCard(i, 's-idle', 'พัก (Remainder)');
      this.laneTo(i, 'rem');
      card.bar.style.width = Math.round(((k + 1) / rounds) * 100) + '%';
      if (k < rounds - 1) await c.sleep(rand(CT.rem[0], CT.rem[1]));
    }
    this.setCard(i, 's-done', 'เสร็จ ✓');
    this.laneTo(i, 'done');
  }

  /* Stress: เร็ว ตัวเลขเยอะ — ไม่มีอนิเมชัน */
  async stressThread(i) {
    const c = this.c;
    const inc = this.cfg.per;
    for (let k = 0; k < inc; k++) {
      if (c.aborted) return;
      if (this.sync) {
        this.tstate[i] = 'wait';
        await this.mutex.acquire(i);
        if (c.aborted) return;
      }
      this.tstate[i] = 'cs';
      this.inCS++;
      if (this.inCS > this.maxCS) this.maxCS = this.inCS;
      const temp = this.counter;
      await yieldPoint();            // ← จุดที่ thread อื่นแทรกได้
      this.counter = temp + 1;
      this.writes++;
      this.inCS--;
      if (this.sync) this.mutex.release();
      this.prog[i] = k + 1;
      this.tstate[i] = 'rem';
      if (Math.random() < 0.6) await yieldPoint();   // ช่วง remainder section สุ่มความช้า-เร็วของแต่ละ thread
    }
    this.tstate[i] = 'done';
  }

  finish() {
    this.done = true;
    const c = this.c;
    const cfg = this.cfg;
    const exp = cfg.n * cfg.per;
    const act = this.counter;
    this.lanes.forEach((L) => { const l = L[L.length - 1]; if (l && l.t1 === null) l.t1 = c.t; });
    this.lastT = c.t;
    if (cfg.visual) this.draw(c.t);
    else {
      this.tstate = this.tstate.map(() => 'done');
      this.prog = this.prog.map(() => cfg.per);
      this.renderStress();
    }
    this.renderTiles();
    this.renderLock();
    this.r.cval.textContent = fmt(act);
    this.r.csub.textContent = `ควรเป็น ${fmt(exp)}`;

    const ok = act === exp;
    const timeTxt = cfg.visual ? ` · ใช้เวลา ${secs1(c.t)} วินาที` : '';
    this.setResult(ok ? 'ok' : 'bad', ok
      ? `✓ ถูกต้อง — Expected ${fmt(exp)} = Actual ${fmt(act)}${timeTxt}`
      : `✗ RACE CONDITION — Expected ${fmt(exp)} ≠ Actual ${fmt(act)} (หายไป ${fmt(exp - act)})${timeTxt}`);
    this.say(ok
      ? `✓ จบการทำงาน: Counter = ${fmt(act)} ตรงกับที่ควรเป็น และมี Thread อยู่ใน CS พร้อมกันสูงสุดแค่ ${this.maxCS}`
      : `✗ จบการทำงาน: Counter ควรเป็น ${fmt(exp)} แต่ได้ ${fmt(act)} — มี Thread อยู่ใน CS พร้อมกันสูงสุด ${this.maxCS} คน`, ok ? 'ok' : 'bad');
    this.log(ok ? '--- done: ไม่มี lost update ---' : `--- done: หายไป ${fmt(exp - act)} ---`, ok ? 'ok' : 'bad');
    if (this.onResult) {
      this.onResult({
        demo: 'Shared Counter',
        mode: this.sync ? 'มี Lock' : 'ไม่มี Lock',
        config: `${cfg.n} threads × ${fmt(cfg.per)} ${cfg.visual ? 'รอบ (Visual)' : 'ครั้ง (Stress)'}`,
        result: `expected ${fmt(exp)} / actual ${fmt(act)} (หาย ${fmt(exp - act)}) · max-in-CS ${this.maxCS}`,
        secs: cfg.visual ? secs1(c.t) + ' s' : '–',
        ok,
      });
    }
  }
}

/* ====================================================================
   STAGE 2 : Producer–Consumer
   ==================================================================== */
const SCEN = {
  pfast: { name: 'Producer เร็วกว่า', p: [700, 1200], c: [1800, 2800] },
  cfast: { name: 'Consumer เร็วกว่า', p: [1800, 2800], c: [700, 1200] },
  even: { name: 'เร็วเท่ากัน', p: [1200, 2000], c: [1200, 2000] },
};
const ITEM = (id) => `🥐<small>#${id}</small>`;

class PCStage {
  constructor(host, sync) {
    this.sync = sync;
    this.kind = sync ? 'sync' : 'nosync';
    this.cfg = null;
    this.c = null;
    this.dirty = false;
    this.finalized = false;
    this.onResult = null;

    this.root = h('section', `stage ${sync ? 'is-sync' : 'is-nosync'}`);
    this.root.dataset.kind = this.kind;
    const meters = sync
      ? `<div class="meters">
           <div class="meter" data-r="mEmptyBox"><span>empty (ที่ว่างเหลือ)</span><b data-r="mEmpty">0</b></div>
           <div class="meter" data-r="mFullBox"><span>full (ของพร้อมหยิบ)</span><b data-r="mFull">0</b></div>
           <div class="meter" data-r="mMutexBox"><span>mutex (กุญแจถาด)</span><b class="lockv" data-r="mMutex">🔓 ว่าง</b></div>
         </div>`
      : `<div class="nometers">ไม่มี Semaphore / Mutex — ไม่มีใครเช็คว่าถาดเต็มหรือว่าง</div>`;
    this.root.innerHTML = `
      <header class="stage-head">
        <span class="badge">${sync ? '✅ มี Semaphore + Mutex' : '❌ ไม่มี Semaphore'}</span>
        <span class="stage-sub">${sync ? 'รอเมื่อถาดเต็ม/ว่าง และแตะถาดได้ทีละคน' : 'ผลิต/หยิบได้ตามใจ ไม่เช็คอะไรเลย'}</span>
      </header>
      <div class="narration" data-r="narr"></div>
      <div class="arena pc-arena" data-r="arena">
        <div class="prod-row" data-r="prods"></div>
        <div class="tray-block">
          <div class="tray-title">TRAY (BUFFER) · <b data-r="level">0 / 0</b></div>
          <div class="tray" data-r="tray"></div>
          ${meters}
        </div>
        <div class="cons-row" data-r="cons"></div>
      </div>
      <div class="tiles">
        <div class="tile"><label>PRODUCED</label><b data-r="vProd">0</b></div>
        <div class="tile"><label>CONSUMED</label><b data-r="vCons">0</b></div>
        <div class="tile" data-r="tTray"><label>ในถาด</label><b data-r="vTray">0</b></div>
        <div class="tile" data-r="tViol"><label>VIOLATIONS</label><b data-r="vViol">0</b><small data-r="vViolSub">overflow 0 · underflow 0</small></div>
      </div>
      <div class="result" data-r="result"></div>
      <div class="log" data-r="log"></div>`;
    host.appendChild(this.root);
    this.r = {};
    $$('[data-r]', this.root).forEach((e) => (this.r[e.dataset.r] = e));
  }

  clear(cfg) {
    this.cfg = cfg;
    this.c = null;
    this.dirty = false;
    this.finalized = false;
    this.size = cfg.size;
    this.buffer = [];
    this.nextId = 0;
    this.produced = 0;
    this.consumed = 0;
    this.overflow = 0;
    this.underflow = 0;
    this.empty = new Sem(cfg.size);
    this.full = new Sem(0);
    this.mutex = new Mutex();

    const mk = (kind, n) => {
      const out = [];
      for (let i = 0; i < n; i++) {
        const el = h('div', 'pcard');
        el.innerHTML = `<div class="av">${kind === 'P' ? '👨‍🍳' : '🛎️'}</div>
          <div><div class="pname">${kind === 'P' ? 'Producer' : 'Consumer'} ${i}</div><div class="pstat">พร้อม</div></div>`;
        out.push({ el, stat: $('.pstat', el) });
      }
      return out;
    };
    this.P = mk('P', cfg.np);
    this.C = mk('C', cfg.nc);
    this.r.prods.innerHTML = '';
    this.r.cons.innerHTML = '';
    this.P.forEach((p) => this.r.prods.appendChild(p.el));
    this.C.forEach((p) => this.r.cons.appendChild(p.el));
    this.r.log.innerHTML = '';
    this.setResult('', 'ยังไม่ได้รัน — กด ▶ run');
    this.say(this.sync
      ? 'Producer/Consumer ต้อง <b>ขอ Semaphore + Mutex</b> ก่อนแตะถาดทุกครั้ง — ถาดเต็มต้องรอ ถาดว่างต้องรอ'
      : 'ไม่มีใคร<b>เช็ค</b>ว่าถาดเต็มหรือว่าง — Producer วางได้เรื่อยๆ Consumer หยิบได้เรื่อยๆ ดูว่าจะเกิดอะไรขึ้น');
    this.renderAll();
  }

  say(msg, kind = '') { this.r.narr.className = 'narration ' + kind; this.r.narr.innerHTML = `<span>${msg}</span>`; }
  setResult(kind, text) { this.r.result.className = 'result ' + kind; this.r.result.textContent = text; }
  log(msg, cls = '') {
    const d = h('div', cls);
    d.textContent = msg;
    this.r.log.appendChild(d);
    while (this.r.log.childElementCount > 300) this.r.log.firstChild.remove();
    this.r.log.scrollTop = this.r.log.scrollHeight;
  }
  setCard(card, cls, text) { card.el.className = 'pcard ' + cls; card.stat.textContent = text; }

  /* ---------- rendering ---------- */
  renderTray(reserve = -1) {
    const len = this.buffer.length;
    const total = Math.max(this.size, len, reserve + 1);
    let html = '';
    for (let i = 0; i < total; i++) {
      const cls = i >= this.size ? 'slot over' : i < len ? 'slot full' : 'slot';
      const inner = i < len ? `🥐<small>#${this.buffer[i].id}</small>` : '';
      html += `<div class="${cls}">${inner}</div>`;
    }
    this.r.tray.innerHTML = html;
  }

  slotEl(i) { return this.r.tray.children[i] || this.r.tray.lastElementChild; }

  renderAll() {
    this.renderTray();
    const len = this.buffer.length;
    const viol = this.overflow + this.underflow;
    this.r.level.textContent = `${len} / ${this.size}`;
    this.r.vProd.textContent = this.produced;
    this.r.vCons.textContent = this.consumed;
    this.r.vTray.textContent = `${len}/${this.size}`;
    this.r.tTray.className = 'tile' + (len > this.size ? ' bad' : '');
    this.r.vViol.textContent = viol;
    this.r.vViolSub.textContent = `overflow ${this.overflow} · underflow ${this.underflow}`;
    this.r.tViol.className = 'tile' + (viol > 0 ? ' bad' : this.produced + this.consumed > 0 ? ' ok' : '');
    this.renderMeters();
  }

  renderMeters() {
    this.dirty = false;
    if (!this.sync) return;
    const r = this.r;
    r.mEmpty.textContent = this.empty.count;
    r.mFull.textContent = this.full.count;
    r.mEmptyBox.className = 'meter' + (this.empty.count === 0 ? ' zero' : '');
    r.mFullBox.className = 'meter' + (this.full.count === 0 ? ' zero' : '');
    const holder = this.mutex.holder;
    r.mMutexBox.className = 'meter' + (holder !== null ? ' held' : '');
    r.mMutex.textContent = holder === null ? '🔓 ว่าง' : `🔒 ${holder}` + (this.mutex.queue.length ? ` (+${this.mutex.queue.length} รอ)` : '');
  }

  delay(role) {
    const [a, b] = SCEN[this.cfg.scen][role];
    return rand(a, b);
  }

  /* ---------- run ---------- */
  start(clock, cfg) {
    this.clear(cfg);
    this.c = clock;
    this.empty = new Sem(cfg.size, () => { this.dirty = true; });
    this.full = new Sem(0, () => { this.dirty = true; });
    this.mutex = new Mutex(() => { this.dirty = true; });
    clock.ticks.add(() => { if (this.dirty && !this.finalized) this.renderMeters(); });
    this.setResult('', 'กำลังรัน… (กด ■ stop หรือรอครบเวลา เพื่อดูสรุปผล)');
    const jobs = [];
    for (let i = 0; i < cfg.np; i++) jobs.push(this.producer(i));
    for (let i = 0; i < cfg.nc; i++) jobs.push(this.consumer(i));
    return Promise.all(jobs);
  }

  flagOver(i) {
    this.overflow++;
    const len = this.buffer.length;
    this.renderAll();
    const s = this.r.tray.children[len - 1];
    if (s) s.classList.add('boom');
    this.say(`⚠ <b>OVERFLOW!</b> Producer ${i} วางของทั้งที่ถาดเต็ม → ตอนนี้มีของ ${len} ชิ้น แต่ถาดมีแค่ ${this.size} ช่อง`, 'bad');
    this.log(`P${i} วางของ → ⚠ OVERFLOW (${len}/${this.size})`, 'bad');
  }

  flagUnder(i, why) {
    this.underflow++;
    this.renderAll();
    this.setCard(this.C[i], 'bad', '💨 หยิบไม่ได้!');
    this.say(`⚠ <b>UNDERFLOW!</b> Consumer ${i} ${why}`, 'bad');
    this.log(`C${i} หยิบของ → ⚠ UNDERFLOW (${why})`, 'bad');
  }

  async producer(i) {
    const c = this.c;
    const P = this.P[i];
    for (;;) {
      this.setCard(P, 'work', 'กำลังผลิตขนม…');
      await c.sleep(this.delay('p'));
      const id = ++this.nextId;

      if (this.sync) {
        if (this.empty.count === 0) {
          this.setCard(P, 'blocked', `⏸ ถือ #${id} แต่ถาดเต็ม — รอ (empty = 0)`);
          this.say(`⏸ <b>Producer ${i} ต้องรอ</b>: ถาดเต็ม (empty = 0) — Semaphore ไม่ให้วางเกินช่อง`, 'ok');
        } else {
          this.setCard(P, 'work', `ถือ #${id} ขอที่ว่าง…`);
        }
        await c.wrap(this.empty.acquire(i));
        await c.wrap(this.mutex.acquire('P' + i));
        this.setCard(P, 'act', `วาง #${id} ลงถาด`);
        const idx = this.buffer.length;
        this.renderTray(idx);
        await fly(c, this.r.arena, P.el, this.slotEl(idx), ITEM(id), 'item', 520);
        this.buffer.push({ id });
        this.produced++;
        this.renderAll();
        this.log(`P${i} วาง #${id} → ถาด ${this.buffer.length}/${this.size}`, 'dim');
        this.mutex.release();
        this.full.release();
      } else {
        this.setCard(P, 'act', `วาง #${id} (ไม่เช็คว่าเต็ม)`);
        const idx = this.buffer.length;
        this.renderTray(idx);
        await fly(c, this.r.arena, P.el, this.slotEl(idx), ITEM(id), 'item', 520);
        this.buffer.push({ id });
        this.produced++;
        if (this.buffer.length > this.size) this.flagOver(i);
        else {
          this.renderAll();
          this.log(`P${i} วาง #${id} → ถาด ${this.buffer.length}/${this.size}`, 'dim');
        }
      }
    }
  }

  async consumer(i) {
    const c = this.c;
    const C = this.C[i];
    for (;;) {
      this.setCard(C, 'work', 'กำลังเสิร์ฟลูกค้า…');
      await c.sleep(this.delay('c'));

      if (this.sync) {
        if (this.full.count === 0) {
          this.setCard(C, 'blocked', '⏸ ถาดว่าง — รอของ (full = 0)');
          this.say(`⏸ <b>Consumer ${i} ต้องรอ</b>: ถาดว่าง (full = 0) — Semaphore ไม่ให้หยิบของที่ไม่มี`, 'ok');
        } else {
          this.setCard(C, 'work', 'ขอหยิบของ…');
        }
        await c.wrap(this.full.acquire(i));
        await c.wrap(this.mutex.acquire('C' + i));
        const item = this.buffer[0];
        this.setCard(C, 'act', `หยิบ #${item.id}`);
        const slot0 = this.r.tray.children[0];
        slot0.classList.add('lifting');
        await fly(c, this.r.arena, slot0, C.el, ITEM(item.id), 'item', 520);
        this.buffer.shift();
        this.consumed++;
        this.renderAll();
        this.log(`C${i} หยิบ #${item.id} → ถาด ${this.buffer.length}/${this.size}`, 'dim');
        this.mutex.release();
        this.empty.release();
      } else {
        // ไม่ sync: เช็คแล้วค่อยไปหยิบ (check-then-act) → คนอื่นหยิบตัดหน้าได้
        if (this.buffer.length === 0) {
          this.flagUnder(i, 'หยิบของจากถาดที่ว่างเปล่า');
          await c.sleep(400);
          continue;
        }
        const item = this.buffer[0];
        this.setCard(C, 'act', `หยิบ #${item.id} (เช็คแล้วว่ามี)`);
        const slot0 = this.r.tray.children[0];
        slot0.classList.add('lifting');
        await fly(c, this.r.arena, slot0, C.el, ITEM(item.id), 'item', 520);
        const got = this.buffer.shift();
        if (!got) {
          this.flagUnder(i, 'เช็คว่ามีของ แต่ไปถึงแล้วมีคนหยิบตัดหน้า');
        } else {
          this.consumed++;
          this.renderAll();
          this.log(`C${i} หยิบ #${got.id} → ถาด ${this.buffer.length}/${this.size}`, 'dim');
        }
      }
    }
  }

  /* เรียกตอนหยุด (ครบเวลา / กด stop) */
  finalize(tMs) {
    if (this.finalized || !this.cfg) return;
    this.finalized = true;
    this.r.arena.querySelectorAll('.chip').forEach((e) => e.remove());
    [...this.P, ...this.C].forEach((p) => { p.el.className = 'pcard stopped'; p.stat.textContent = 'หยุดแล้ว'; });
    this.renderAll();
    const viol = this.overflow + this.underflow;
    const tail = `produced ${this.produced}, consumed ${this.consumed}, ค้างในถาด ${this.buffer.length}/${this.size}`;
    const time = ` · ${secs1(tMs)} วินาที`;
    let ok;
    if (this.sync) {
      ok = viol === 0;
      this.setResult(ok ? 'ok' : 'bad', ok
        ? `✓ ไม่เกิด Overflow/Underflow เลย (violations = 0) — ${tail}${time}`
        : `✗ พบ ${viol} violations — ${tail}${time}`);
    } else if (viol > 0) {
      ok = false;
      this.setResult('bad', `✗ พบ ${viol} violations (overflow ${this.overflow}, underflow ${this.underflow}) — ${tail}${time}`);
    } else {
      ok = true;
      this.setResult('warn', `ยังไม่พบ violation ในรอบนี้ — แต่ไม่ได้แปลว่าปลอดภัย (${tail}${time}) ลองเปลี่ยนสถานการณ์หรือรันนานขึ้น`);
    }
    this.log(`--- stop: violations = ${viol} ---`, ok ? 'ok' : 'bad');
    if (this.onResult) {
      this.onResult({
        demo: 'Producer–Consumer',
        mode: this.sync ? 'มี Semaphore' : 'ไม่มี Semaphore',
        config: `buffer ${this.size}, ${this.cfg.np}P/${this.cfg.nc}C, ${SCEN[this.cfg.scen].name}`,
        result: `produced ${this.produced}, consumed ${this.consumed}, violations ${viol} (overflow ${this.overflow}, underflow ${this.underflow})`,
        secs: secs1(tMs) + ' s',
        ok,
      });
    }
  }
}

/* ====================================================================
   TAB controllers
   ==================================================================== */
class TabBase {
  constructor(root) {
    this.root = root;
    this.clock = null;
    this.running = false;
    this.view = 'both';
    this.stages = [];
    this.stagesEl = $('.stages', root);
    this.btn = {};
    $$('[data-act]', root).forEach((b) => (this.btn[b.dataset.act] = b));
    this.btn.run.addEventListener('click', (e) => { e.currentTarget.blur(); this.run(); });
    this.btn.reset.addEventListener('click', (e) => { e.currentTarget.blur(); this.reset(); });
    if (this.btn.pause) this.btn.pause.addEventListener('click', (e) => { e.currentTarget.blur(); this.togglePause(); });
    if (this.btn.stop) this.btn.stop.addEventListener('click', (e) => { e.currentTarget.blur(); this.stop(); });
    $$('.seg[data-seg="view"] button', root).forEach((b) => b.addEventListener('click', () => this.setView(b.dataset.v)));
  }

  setView(v) {
    this.view = v;
    this.stagesEl.dataset.view = v;
    $$('.seg[data-seg="view"] button', this.root).forEach((b) => b.classList.toggle('on', b.dataset.v === v));
    requestAnimationFrame(() => this.stages.forEach((s) => s.redraw && s.redraw()));
  }

  get active() { return this.stages.filter((s) => this.view === 'both' || s.kind === this.view); }

  setRunning(on) {
    this.running = on;
    $$('[data-lock-on-run]', this.root).forEach((e) => (e.disabled = on));
    this.btn.run.disabled = on;
    if (this.btn.pause) { this.btn.pause.disabled = !on; this.btn.pause.textContent = '⏸ pause'; }
    if (this.btn.stop) this.btn.stop.disabled = !on;
  }

  togglePause() {
    if (!this.running || !this.clock) return;
    if (this.clock.paused) { this.clock.resume(); this.btn.pause.textContent = '⏸ pause'; }
    else { this.clock.pause(); this.btn.pause.textContent = '▶ เล่นต่อ'; }
  }

  autoPause() {
    if (this.running && this.clock && !this.clock.paused && this.btn.pause && this.btn.pause.offsetParent !== null) this.togglePause();
  }

  stop() {}
}

/* ---------------------------------------------------------- Tab 1 */
class CounterTab extends TabBase {
  constructor(root) {
    super(root);
    this.mode = 'visual';
    this.el = {
      threads: $('#c-threads'), n: $('#c-n'), nLabel: $('#c-n-label'),
      speed: $('#c-speed'), speedVal: $('#c-speed-val'), timer: $('#c-timer'),
    };
    this.stages = [new CounterStage(this.stagesEl, false), new CounterStage(this.stagesEl, true)];
    this.stages.forEach((s) => (s.onResult = (row) => History.add(row)));

    $$('.seg[data-seg="mode"] button', root).forEach((b) => b.addEventListener('click', () => this.setMode(b.dataset.v)));
    this.el.speed.addEventListener('input', () => {
      this.el.speedVal.textContent = this.el.speed.value + '×';
      if (this.clock) this.clock.speed = parseFloat(this.el.speed.value);
    });
    [this.el.threads, this.el.n].forEach((e) => e.addEventListener('change', () => { if (!this.running) this.reset(); }));
    this.setMode('visual');
  }

  setMode(m) {
    this.mode = m;
    this.root.dataset.mode = m;
    $$('.seg[data-seg="mode"] button', this.root).forEach((b) => b.classList.toggle('on', b.dataset.v === m));
    if (m === 'visual') {
      this.el.nLabel.textContent = 'รอบ / thread';
      Object.assign(this.el.n, { min: 1, max: 6, step: 1, value: 2 });
      Object.assign(this.el.threads, { max: 8 });
      if (+this.el.threads.value > 8) this.el.threads.value = 8;
    } else {
      this.el.nLabel.textContent = 'บวกกี่ครั้ง / thread';
      Object.assign(this.el.n, { min: 100, max: 100000, step: 1000, value: 8000 });
      Object.assign(this.el.threads, { max: 10 });
    }
    this.reset();
  }

  readCfg() {
    const visual = this.mode === 'visual';
    const n = clampInt(this.el.threads.value, 2, visual ? 8 : 10, 5);
    const per = visual ? clampInt(this.el.n.value, 1, 6, 2) : clampInt(this.el.n.value, 100, 100000, 8000);
    this.el.threads.value = n;
    this.el.n.value = per;
    return { visual, n, per, speed: parseFloat(this.el.speed.value) || 1 };
  }

  reset() {
    if (this.clock) { this.clock.abort(); this.clock = null; }
    this.setRunning(false);
    const cfg = this.readCfg();
    this.stages.forEach((s) => s.clear(cfg));
    this.el.timer.textContent = '⏱ 0.0s';
  }

  async run() {
    if (this.running) return;
    this.reset();
    const cfg = this.readCfg();
    const clock = new Clock();
    clock.speed = cfg.speed;
    this.clock = clock;
    this.setRunning(true);
    const wall0 = performance.now();
    clock.ticks.add((t) => {
      this.el.timer.textContent = '⏱ ' + secs1(cfg.visual ? t : performance.now() - wall0) + 's';
    });
    clock.start();
    try {
      await Promise.all(this.active.map((s) => s.start(clock, cfg)));
    } catch (e) {
      if (!(e instanceof Abort)) { console.error(e); this.setRunning(false); }
      return;
    }
    if (clock.aborted) return;
    clock.stop();
    this.setRunning(false);
  }
}

/* ---------------------------------------------------------- Tab 2 */
class PCTab extends TabBase {
  constructor(root) {
    super(root);
    this.el = {
      size: $('#p-size'), np: $('#p-np'), nc: $('#p-nc'), scen: $('#p-scen'),
      speed: $('#p-speed'), speedVal: $('#p-speed-val'), auto: $('#p-auto'), timer: $('#p-timer'),
    };
    this.stages = [new PCStage(this.stagesEl, false), new PCStage(this.stagesEl, true)];
    this.stages.forEach((s) => (s.onResult = (row) => History.add(row)));
    this.el.speed.addEventListener('input', () => {
      this.el.speedVal.textContent = this.el.speed.value + '×';
      if (this.clock) this.clock.speed = parseFloat(this.el.speed.value);
    });
    [this.el.size, this.el.np, this.el.nc].forEach((e) => e.addEventListener('change', () => { if (!this.running) this.reset(); }));
    this.reset();
  }

  readCfg() {
    const size = clampInt(this.el.size.value, 2, 10, 6);
    const np = clampInt(this.el.np.value, 1, 4, 2);
    const nc = clampInt(this.el.nc.value, 1, 4, 2);
    this.el.size.value = size;
    this.el.np.value = np;
    this.el.nc.value = nc;
    return { size, np, nc, scen: this.el.scen.value, speed: parseFloat(this.el.speed.value) || 1, auto: this.el.auto.checked };
  }

  reset() {
    if (this.clock) { this.clock.abort(); this.clock = null; }
    this.setRunning(false);
    const cfg = this.readCfg();
    this.stages.forEach((s) => s.clear(cfg));
    this.el.timer.textContent = '⏱ 0:00 / ' + (cfg.auto ? '0:30' : '∞');
  }

  run() {
    if (this.running) return;
    this.reset();
    const cfg = this.readCfg();
    const clock = new Clock();
    clock.speed = cfg.speed;
    this.clock = clock;
    this.setRunning(true);
    clock.ticks.add((t) => {
      this.el.timer.textContent = `⏱ ${mmss(t)} / ${cfg.auto ? '0:30' : '∞'}`;
      if (cfg.auto && t >= 30000) this.stop();
    });
    clock.start();
    this.active.forEach((s) => s.start(clock, cfg).catch((e) => { if (!(e instanceof Abort)) console.error(e); }));
  }

  stop() {
    if (!this.running || !this.clock) return;
    const clock = this.clock;
    const t = clock.t;
    clock.abort();
    this.active.forEach((s) => s.finalize(t));
    this.clock = null;
    this.setRunning(false);
  }
}

/* ====================================================================
   boot
   ==================================================================== */
const tabs = {
  counter: new CounterTab($('#tab-counter')),
  pc: new PCTab($('#tab-pc')),
};
let activeTab = 'counter';

$$('.tab-btn').forEach((btn) => btn.addEventListener('click', () => {
  const key = btn.dataset.tab;
  if (key === activeTab) return;
  tabs[activeTab].autoPause();
  activeTab = key;
  $$('.tab-btn').forEach((b) => b.classList.toggle('active', b === btn));
  $$('.tab-panel').forEach((p) => p.classList.toggle('active', p.id === 'tab-' + key));
  requestAnimationFrame(() => tabs[key].stages.forEach((s) => s.redraw && s.redraw()));
}));

window.addEventListener('resize', () => tabs.counter.stages.forEach((s) => s.redraw()));

document.addEventListener('keydown', (e) => {
  if (e.target.closest && e.target.closest('input, select, textarea, button')) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const tab = tabs[activeTab];
  if (e.code === 'Space') {
    e.preventDefault();
    if (!tab.running) tab.run(); else tab.togglePause();
  } else if (e.key === 'r' || e.key === 'R') {
    tab.reset();
  }
});

$('#hist-copy').addEventListener('click', () => History.copy());
$('#hist-clear').addEventListener('click', () => { History.rows = []; History.render(); });
History.render();
