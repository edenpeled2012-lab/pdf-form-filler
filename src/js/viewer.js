/* =====================================================================
   viewer.js — ציור העמודים, שכבת השדות, והפאנל הצדדי
   ===================================================================== */
"use strict";
window.Viewer = (function () {

const $ = s => document.querySelector(s);
const ICON = {text:'א', id:'#', date:'📅', signature:'✍', checkbox:'☑', phone:'☎', email:'@'};

let S = null;                 /* מצב האפליקציה — מוזרק מ-app.js */
function attach(state) { S = state; }

/* ---------------------------------------------------------------
   ציור כל העמודים
   --------------------------------------------------------------- */
async function renderAll() {
  const host = $('#pages');
  host.innerHTML = '';
  for (let i = 0; i < S.pages.length; i++) {
    const page = S.pages[i];
    const vp = page.getViewport({scale: S.zoom});

    const wrap = document.createElement('div');
    wrap.className = 'page';
    wrap.style.width = vp.width + 'px';
    wrap.style.height = vp.height + 'px';

    const cv = document.createElement('canvas');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = Math.floor(vp.width * dpr);
    cv.height = Math.floor(vp.height * dpr);
    cv.style.width = vp.width + 'px';
    cv.style.height = vp.height + 'px';

    const layer = document.createElement('div');
    layer.className = 'layer';
    layer.dataset.page = String(i + 1);

    wrap.append(cv, layer);
    host.append(wrap);

    await page.render({
      canvasContext: cv.getContext('2d'),
      viewport: vp,
      transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null
    }).promise;

    for (const f of S.fields) if (f.page === i + 1) layer.append(buildField(f, vp));
    bindAdd(layer, vp, i + 1);
  }
  renderList();
}

/* המרה מ-user space של PDF לפיקסלים על המסך.
   ה-viewport מטפל לבד בזום ובסיבוב העמוד. */
function place(el, f, vp) {
  const [a, b, c, d] = vp.convertToViewportRectangle([f.x, f.y, f.x + f.w, f.y + f.h]);
  el.style.left   = Math.min(a, c) + 'px';
  el.style.top    = Math.min(b, d) + 'px';
  el.style.width  = Math.abs(c - a) + 'px';
  el.style.height = Math.abs(d - b) + 'px';
}

/* ---------------------------------------------------------------
   שדה בודד
   --------------------------------------------------------------- */
function buildField(f, vp) {
  const el = document.createElement('div');
  el.className = 'fld k-' + f.kind;
  el.dataset.id = f.id;
  el.title = f.name + ' · ביטחון ' + Math.round(f.conf * 100) + '%';
  place(el, f, vp);

  if (f.kind === 'signature' || f.kind === 'date' || f.kind === 'checkbox') {
    const b = document.createElement('button');
    b.className = 'fin';
    b.type = 'button';
    b.onclick = () => {
      select(f.id);
      if (f.kind === 'signature') UI.openSign(f, (ff, url) => setValue(ff, url));
      else if (f.kind === 'date') UI.openDate(f, (ff, v) => setValue(ff, v));
      else setValue(f, f.value ? '' : '1');
    };
    el.append(b);
  } else {
    const inp = document.createElement(f.multi ? 'textarea' : 'input');
    inp.className = 'fin';
    inp.dir = (f.kind === 'phone' || f.kind === 'id' || f.kind === 'email') ? 'ltr' : 'auto';
    inp.style.fontSize = Math.max(9, Math.min(f.h * 0.62, 11) * vp.scale) + 'px';   /* כמו בייצוא */
    if (f.slots) slotStyle(inp, f, vp);
    inp.value = f.value || '';
    inp.oninput = () => setValue(f, inp.value, el, true);
    inp.onfocus = () => select(f.id);
    el.append(inp);
  }

  const grip = document.createElement('div'); grip.className = 'grip'; grip.title = 'הזז';
  const res  = document.createElement('div'); res.className  = 'res';  res.title  = 'שנה גודל';
  const del  = document.createElement('button'); del.className = 'del'; del.type = 'button';
  del.textContent = '✕'; del.title = 'מחק שדה';
  del.onclick = e => {
    e.stopPropagation();
    S.fields = S.fields.filter(x => x !== f);
    el.remove();
    renderList();
  };
  el.append(grip, res, del);
  drag(grip, f, el, vp, 'move');
  drag(res,  f, el, vp, 'size');
  paint(f, el);
  return el;
}

/* שדה משבצות: גופן ברוחב קבוע ומרווח אותיות לפי רוחב המשבצת,
   כדי שכל תו ייראה על המסך באותה משבצת שבה הוא ייכתב ב-PDF. */
function slotStyle(inp, f, vp) {
  const n = f.slots.length - 1;
  const slotPx = (f.slots[n] - f.slots[0]) / n * vp.scale;
  const fs = Math.min(f.h * vp.scale * 0.8, slotPx * 0.95);
  const cw = fs * 0.6;                         /* Courier: רוחב תו = 0.6em */
  inp.dir = 'ltr';
  inp.maxLength = n;
  Object.assign(inp.style, {
    fontFamily: '"Courier New",monospace', fontSize: fs + 'px',
    letterSpacing: (slotPx - cw) + 'px', paddingLeft: ((slotPx - cw) / 2) + 'px',
    paddingRight: '0', textAlign: 'left'
  });
}

function paint(f, el) {
  el = el || document.querySelector('.fld[data-id="' + f.id + '"]');
  if (!el) return;
  const b = el.querySelector('button.fin');
  if (b) {
    b.innerHTML = '';
    const h = parseFloat(el.style.height) || 14;
    if (f.kind === 'signature') {
      if (f.value) { const im = new Image(); im.src = f.value; b.append(im); }
      else b.textContent = '✍ חתימה';
    } else if (f.kind === 'date') {
      b.textContent = f.value || '📅 תאריך';
      b.style.fontSize = Math.max(9, h * 0.58) + 'px';
      b.style.color = f.value ? '#101c33' : '#2b4a86';
    } else {
      b.textContent = f.value ? '✔' : '';
      b.style.fontSize = Math.max(11, h * 0.8) + 'px';
      b.style.color = '#101c33';
    }
  }
  el.classList.toggle('done', !!f.value);
}

function setValue(f, v, el, fromPage) {
  f.value = v;
  S.saved = false;
  paint(f, el);
  syncList(f, fromPage);
}

function select(id) {
  document.querySelectorAll('.fld').forEach(e => e.classList.toggle('on', e.dataset.id === id));
  document.querySelectorAll('.frow').forEach(e => e.classList.toggle('on', e.dataset.id === id));
}

/* ---------------------------------------------------------------
   גרירה ושינוי גודל — רשת ביטחון, לא חלק מהזרימה הרגילה
   --------------------------------------------------------------- */
function drag(handle, f, el, vp, mode) {
  handle.addEventListener('pointerdown', e => {
    e.preventDefault(); e.stopPropagation();
    handle.setPointerCapture(e.pointerId);
    const sx = e.clientX, sy = e.clientY;
    const o = {x: f.x, y: f.y, w: f.w, h: f.h};
    const move = ev => {
      const dx = (ev.clientX - sx) / vp.scale;
      const dy = -(ev.clientY - sy) / vp.scale;
      if (mode === 'move') {
        if (f.slots) f.slots = f.slots.map(x => x + (o.x + dx - f.x));
        f.x = o.x + dx; f.y = o.y + dy;
      }
      else { f.slots = null; f.w = Math.max(14, o.w + dx); f.h = Math.max(8, o.h - dy); f.y = o.y + dy; }
      place(el, f, vp);
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
  });
}

function bindAdd(layer, vp, pageNum) {
  layer.addEventListener('pointerdown', e => {
    if (!S.add || e.target !== layer) return;
    const r = layer.getBoundingClientRect();
    const x0 = e.clientX - r.left, y0 = e.clientY - r.top;
    const band = document.createElement('div');
    band.className = 'band';
    layer.append(band);
    const move = ev => {
      const x = ev.clientX - r.left, y = ev.clientY - r.top;
      band.style.left = Math.min(x, x0) + 'px';
      band.style.top = Math.min(y, y0) + 'px';
      band.style.width = Math.abs(x - x0) + 'px';
      band.style.height = Math.abs(y - y0) + 'px';
    };
    const up = ev => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      band.remove();
      const x = ev.clientX - r.left, y = ev.clientY - r.top;
      if (Math.abs(x - x0) < 14 || Math.abs(y - y0) < 8) return;
      const p1 = vp.convertToPdfPoint(Math.min(x, x0), Math.max(y, y0));
      const p2 = vp.convertToPdfPoint(Math.max(x, x0), Math.min(y, y0));
      const f = {
        id: 'f' + (++S.seq), page: pageNum,
        x: Math.min(p1[0], p2[0]), y: Math.min(p1[1], p2[1]),
        w: Math.abs(p2[0] - p1[0]), h: Math.abs(p2[1] - p1[1]),
        kind: 'text', name: 'שדה ידני', conf: 1, src: 'manual', value: ''
      };
      S.fields.push(f);
      layer.append(buildField(f, vp));
      renderList();
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
  });
}

/* ---------------------------------------------------------------
   הפאנל הצדדי
   --------------------------------------------------------------- */
function renderList() {
  $('#fieldcount').textContent = S.fields.length;
  const host = $('#fieldlist');
  host.innerHTML = '';
  for (const f of S.fields) {
    const row = document.createElement('div');
    row.className = 'frow';
    row.dataset.id = f.id;

    const srcClass = f.src === 'acroform' ? 'src-acroform'
                   : f.src === 'cross'    ? 'src-cross'
                   : f.src === 'manual'   ? 'src-manual' : 'src-weak';
    const ttl = document.createElement('div');
    ttl.className = 'ttl';
    ttl.innerHTML = '<i class="dot ' + srcClass + '"></i>' +
                    '<span>' + (ICON[f.kind] || 'א') + ' ' + escapeHtml(f.name) + '</span>' +
                    '<span class="pg">עמ\' ' + f.page + '</span>';
    row.append(ttl);

    let ctl;
    if (f.kind === 'date' || f.kind === 'signature' || f.kind === 'checkbox') {
      ctl = document.createElement('button');
      ctl.className = 'val';
      ctl.type = 'button';
      ctl.onclick = () => {
        select(f.id);
        if (f.kind === 'signature') UI.openSign(f, (ff, url) => setValue(ff, url));
        else if (f.kind === 'date') UI.openDate(f, (ff, v) => setValue(ff, v));
        else setValue(f, f.value ? '' : '1');
      };
    } else {
      ctl = document.createElement('input');
      ctl.dir = (f.kind === 'phone' || f.kind === 'id' || f.kind === 'email') ? 'ltr' : 'auto';
      ctl.value = f.value || '';
      ctl.oninput = () => { f.value = ctl.value; S.saved = false; paint(f); };
      ctl.onfocus = () => select(f.id);
    }
    row.append(ctl);
    syncRow(f, row);

    ttl.onclick = () => {
      select(f.id);
      const el = document.querySelector('.fld[data-id="' + f.id + '"]');
      if (el) el.scrollIntoView({block: 'center', behavior: 'smooth'});
    };
    host.append(row);
  }
}

function syncRow(f, row) {
  const ctl = row.querySelector('input, button.val');
  if (!ctl) return;
  if (ctl.tagName === 'INPUT') {
    if (ctl.value !== (f.value || '')) ctl.value = f.value || '';
  } else {
    ctl.innerHTML = '';
    if (f.kind === 'signature' && f.value) { const im = new Image(); im.src = f.value; ctl.append(im); }
    else ctl.textContent = f.value || (f.kind === 'date' ? 'בחר תאריך'
                                     : f.kind === 'signature' ? 'חתום' : 'סמן');
  }
}

function syncList(f) {
  const row = document.querySelector('.frow[data-id="' + f.id + '"]');
  if (row) syncRow(f, row);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
}

return {attach, renderAll, renderList, select, setValue, paint};
})();
