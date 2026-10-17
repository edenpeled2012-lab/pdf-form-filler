/* =====================================================================
   ui.js — משטח החתימה, לוח השנה, רינדור טקסט לתמונה, וחיוויים
   ===================================================================== */
"use strict";
window.UI = (function () {

const $ = s => document.querySelector(s);

/* ---------------------------------------------------------------
   חיוויים
   --------------------------------------------------------------- */
let toastTimer = null;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2800);
}
function progress(msg, pct) {
  const p = $('#progress');
  if (!msg) { p.hidden = true; return; }
  p.hidden = false;
  $('#progresstext').textContent = msg;
  $('#barfill').style.width = (pct || 10) + '%';
}

/* ---------------------------------------------------------------
   חתימה — משטח ציור
   --------------------------------------------------------------- */
let signTarget = null, signDone = null, drawing = false, last = null, inked = false;
const pad = $('#signpad'), pctx = pad.getContext('2d');
pctx.lineWidth = 3.2; pctx.lineCap = 'round'; pctx.lineJoin = 'round'; pctx.strokeStyle = '#13213c';

const padPt = e => {
  const r = pad.getBoundingClientRect();
  return [(e.clientX - r.left) * pad.width / r.width, (e.clientY - r.top) * pad.height / r.height];
};
pad.addEventListener('pointerdown', e => {
  pad.setPointerCapture(e.pointerId);
  drawing = true; inked = true; last = padPt(e);
  pctx.beginPath(); pctx.moveTo(last[0], last[1]); pctx.lineTo(last[0] + 0.1, last[1]); pctx.stroke();
});
pad.addEventListener('pointermove', e => {
  if (!drawing) return;
  const p = padPt(e);
  const mid = [(last[0] + p[0]) / 2, (last[1] + p[1]) / 2];
  pctx.beginPath(); pctx.moveTo(last[0], last[1]);
  pctx.quadraticCurveTo(last[0], last[1], mid[0], mid[1]);
  pctx.stroke();
  last = p;
});
['pointerup', 'pointerleave', 'pointercancel'].forEach(ev =>
  pad.addEventListener(ev, () => { drawing = false; }));

$('#signclear').onclick = () => { pctx.clearRect(0, 0, pad.width, pad.height); inked = false; };
$('#signcancel').onclick = () => { $('#signmodal').hidden = true; };
$('#signok').onclick = () => {
  if (!inked) { toast('צייר חתימה קודם'); return; }
  const url = trimCanvas(pad);
  $('#signmodal').hidden = true;
  if (signDone) signDone(signTarget, url);
};

function openSign(field, done) {
  signTarget = field; signDone = done; inked = false;
  pctx.clearRect(0, 0, pad.width, pad.height);
  $('#signmodal').hidden = false;
}

/* חותכים את השוליים הריקים כדי שהחתימה תמלא את התיבה */
function trimCanvas(cv) {
  const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
  let x0 = cv.width, y0 = cv.height, x1 = 0, y1 = 0, has = false;
  for (let y = 0; y < cv.height; y++) {
    for (let x = 0; x < cv.width; x++) {
      if (d[(y * cv.width + x) * 4 + 3] > 12) {
        has = true;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (!has) return cv.toDataURL('image/png');
  const m = 6, w = x1 - x0 + 1 + m * 2, h = y1 - y0 + 1 + m * 2;
  const o = document.createElement('canvas');
  o.width = w; o.height = h;
  o.getContext('2d').drawImage(cv, x0 - m, y0 - m, w, h, 0, 0, w, h);
  return o.toDataURL('image/png');
}

/* ---------------------------------------------------------------
   תאריך — לוח שנה
   --------------------------------------------------------------- */
let dateTarget = null, dateDone = null;
let calView = new Date(), calSel = new Date();

const MONTHS = Array.from({length: 12}, (_, i) =>
  new Intl.DateTimeFormat('he-IL', {month: 'long'}).format(new Date(2026, i, 15)));

$('#caldow').innerHTML = ['א','ב','ג','ד','ה','ו','ש'].map(d => '<div>' + d + '</div>').join('');
MONTHS.forEach((m, i) => $('#calmonth').add(new Option(m, i)));
const thisYear = new Date().getFullYear();
for (let y = thisYear - 90; y <= thisYear + 10; y++) $('#calyear').add(new Option(y, y));

function fmtDate(d, f) {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yy = d.getFullYear();
  if (f === 'dd/mm/yyyy') return dd + '/' + mm + '/' + yy;
  if (f === 'dd.mm.yyyy') return dd + '.' + mm + '.' + yy;
  if (f === 'dd-mm-yyyy') return dd + '-' + mm + '-' + yy;
  if (f === 'yyyy-mm-dd') return yy + '-' + mm + '-' + dd;
  return d.getDate() + ' ב' + MONTHS[d.getMonth()] + ' ' + yy;
}

function drawCal() {
  $('#calmonth').value = calView.getMonth();
  $('#calyear').value = calView.getFullYear();
  const first = new Date(calView.getFullYear(), calView.getMonth(), 1);
  const start = new Date(first);
  start.setDate(1 - first.getDay());                   /* ראשון ראשון, כמו בלוח עברי */
  const today = new Date(), g = $('#calgrid');
  g.innerHTML = '';
  for (let i = 0; i < 42; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = d.getDate();
    if (d.getMonth() !== calView.getMonth()) b.className = 'out';
    if (d.toDateString() === today.toDateString()) b.classList.add('today');
    if (d.toDateString() === calSel.toDateString()) b.classList.add('sel');
    b.onclick = () => { calSel = new Date(d); calView = new Date(d); drawCal(); };
    g.append(b);
  }
  $('#calpreview').textContent = fmtDate(calSel, $('#calformat').value);
}

$('#calprev').onclick   = () => { calView.setMonth(calView.getMonth() - 1); drawCal(); };
$('#calnext').onclick   = () => { calView.setMonth(calView.getMonth() + 1); drawCal(); };
$('#calmonth').onchange = () => { calView.setMonth(+$('#calmonth').value); drawCal(); };
$('#calyear').onchange  = () => { calView.setFullYear(+$('#calyear').value); drawCal(); };
$('#calformat').onchange = drawCal;
$('#caltoday').onclick  = () => { calSel = new Date(); calView = new Date(); drawCal(); };
$('#calcancel').onclick = () => { $('#datemodal').hidden = true; };
$('#calok').onclick = () => {
  const v = fmtDate(calSel, $('#calformat').value);
  $('#datemodal').hidden = true;
  if (dateDone) dateDone(dateTarget, v);
};

function openDate(field, done) {
  dateTarget = field; dateDone = done;
  calSel = new Date(); calView = new Date();
  drawCal();
  $('#datemodal').hidden = false;
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { $('#signmodal').hidden = true; $('#datemodal').hidden = true; }
});

/* ---------------------------------------------------------------
   רינדור טקסט לתמונה
   זה מה שעוקף את בעיית הפונטים וה-bidi: הדפדפן יודע עברית
   מצוין, pdf-lib לא יודע בכלל. אז מציירים ומטביעים PNG.
   --------------------------------------------------------------- */
function rasterText(text, wPt, hPt, sizePt) {
  const S = 4;
  const cw = Math.max(8, Math.round(wPt * S));
  const ch = Math.max(8, Math.round(hPt * S));
  const cv = document.createElement('canvas');
  cv.width = cw; cv.height = ch;
  const c = cv.getContext('2d');

  const lines = String(text).split('\n');
  const font = s => s + 'px "Segoe UI","Arial",sans-serif';
  /* גודל אחיד לכל הטופס (כמו כתב יד בגודל קבוע) — שדה גבוה לא מקבל
     אותיות ענק. רק שדה צר מדי מקטין את הגופן. */
  const TARGET_PT = sizePt || 11;
  let size = Math.min(TARGET_PT * S, ch * (lines.length === 1 ? 0.85 : 0.72 / lines.length));
  c.font = font(size);
  let guard = 0;
  while (lines.some(l => c.measureText(l).width > cw - 6 * S) && size > 7 && guard++ < 120) {
    size -= 1;
    c.font = font(size);
  }

  const heb = Detect.HEB.test(text);
  c.direction = heb ? 'rtl' : 'ltr';
  c.textAlign = heb ? 'right' : 'left';
  c.textBaseline = 'alphabetic';
  c.fillStyle = '#101c33';

  const x = heb ? cw - 3 * S : 3 * S;
  const lh = size * 1.18;
  /* תיבה גבוהה (כמה שורות) — כותבים מלמעלה, כמו על נייר */
  const tall = ch > lh * (lines.length + 1.2);
  const y0 = tall ? 3 * S + size
           : lines.length === 1 ? ch * 0.76 : ch * 0.5 - (lines.length - 1) * lh / 2 + size * 0.35;
  lines.forEach((l, i) => c.fillText(l, x, y0 + i * lh));
  return cv.toDataURL('image/png');
}

/* תו בודד ממורכז במשבצת */
function rasterChar(ch, wPt, hPt) {
  const S = 4;
  const cv = document.createElement('canvas');
  cv.width = Math.max(8, Math.round(wPt * S));
  cv.height = Math.max(8, Math.round(hPt * S));
  const c = cv.getContext('2d');
  const size = Math.min(cv.height * 0.8, cv.width * 1.1);
  c.font = size + 'px "Segoe UI","Arial",sans-serif';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillStyle = '#101c33';
  c.fillText(ch, cv.width / 2, cv.height * 0.55);
  return cv.toDataURL('image/png');
}

function rasterCheck(wPt, hPt) {
  const S = 4;
  const cv = document.createElement('canvas');
  cv.width = Math.max(8, Math.round(wPt * S));
  cv.height = Math.max(8, Math.round(hPt * S));
  const c = cv.getContext('2d');
  c.strokeStyle = '#101c33';
  c.lineWidth = Math.max(2, cv.height * 0.1);
  c.lineCap = 'round'; c.lineJoin = 'round';
  c.beginPath();
  c.moveTo(cv.width * 0.20, cv.height * 0.55);
  c.lineTo(cv.width * 0.44, cv.height * 0.80);
  c.lineTo(cv.width * 0.82, cv.height * 0.22);
  c.stroke();
  return cv.toDataURL('image/png');
}

return {toast, progress, openSign, openDate, rasterText, rasterChar, rasterCheck, fmtDate};
})();
