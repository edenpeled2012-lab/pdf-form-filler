/* =====================================================================
   app.js — חיווט: טעינה, זיהוי, ציור, הורדה
   ===================================================================== */
"use strict";
(function () {

const $ = s => document.querySelector(s);
const CDN = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174';
const WORKER = CDN + '/build/pdf.worker.min.js';

/* ה-worker נמשך כטקסט והופך ל-blob, כדי שהכל יעבוד גם כשפותחים
   את index.html ישירות מהדיסק (file://) בלי שרת מקומי. */
const workerReady = (async () => {
  try {
    const r = await fetch(WORKER);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const src = await r.text();
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      URL.createObjectURL(new Blob([src], {type: 'text/javascript'}));
  } catch (e) {
    console.warn('נפילה חזרה ל-workerSrc ישיר', e);
    pdfjsLib.GlobalWorkerOptions.workerSrc = WORKER;
  }
})();

const S = {
  bytes: null, doc: null, pages: [], fields: [],
  zoom: 1.25, add: false, name: 'form.pdf', seq: 0
};
Viewer.attach(S);

/* ---------------------------------------------------------------
   טעינה + זיהוי אוטומטי מלא
   --------------------------------------------------------------- */
async function loadPdf(buf, name) {
  await workerReady;
  /* "זהה מחדש" על אותו קובץ לא מוחק את מה שכבר מולא: ערכים עוברים
     לשדה החדש שבאותו מקום, ושדות ידניים נשמרים כמו שהם */
  const prev = buf === S.bytes ? S.fields.filter(f => f.value || f.src === 'manual') : [];
  S.bytes = buf;
  S.name = name || 'form.pdf';
  S.fields = []; S.pages = []; S.seq = 0;

  UI.progress('טוען מסמך…', 5);
  /* disableFontFace הוא קריטי לעברית: כברירת מחדל pdf.js מטעין את
     הפונט המוטמע כ-@font-face ומצייר עם מנוע הטקסט של הדפדפן —
     והדפדפן מפעיל bidi ו-shaping משלו על הגליפים ומערבב את האותיות.
     עם false הגליפים מצוירים כ-paths, בדיוק במיקום שה-PDF מכתיב.

     cMaps ופונטים סטנדרטיים נדרשים כי יש כאן פונטים עם Identity-H
     וגם פונטים בלי ToUnicode. */
  S.doc = await pdfjsLib.getDocument({
    data: buf.slice(0),
    disableFontFace: true,
    cMapUrl: CDN + '/cmaps/',
    cMapPacked: true,
    standardFontDataUrl: CDN + '/standard_fonts/'
  }).promise;

  const all = [];
  for (let p = 1; p <= S.doc.numPages; p++) {
    UI.progress('מזהה שדות — עמוד ' + p + ' מתוך ' + S.doc.numPages, 5 + 80 * p / S.doc.numPages);
    const page = await S.doc.getPage(p);
    S.pages.push(page);
    const found = await Detect.detectPage(page, p);
    for (const f of found) all.push(Object.assign({}, f, {id: 'f' + (++S.seq), value: ''}));
  }

  /* כותרת עליונה שחוזרת בכל העמודים אינה שדה */
  const kept = Detect.dropRepeats(all, S.doc.numPages);
  carryOver(prev, kept);

  S.fields = kept;

  /* שכבת AI (אם הופעלה): מסננת, נותנת שמות וסוגים, ומשלימה מה שפוספס */
  let aiNote = '';
  if (window.AI && AI.enabled()) {
    UI.progress('AI בודק את העמודים…', 86);
    try {
      const r = await AI.refine(S, (d, n) => UI.progress('AI בודק — עמוד ' + d + ' מתוך ' + n, 86 + 6 * d / n));
      if (r.error && r.failed === S.pages.length) throw r.error;
      aiNote = ' · AI: ' + (r.added ? '+' + r.added : '') + (r.dropped ? ' −' + r.dropped : '') + (r.failed ? ' (' + r.failed + ' עמודים נכשלו)' : '');
    } catch (err) {
      console.error(err);
      aiNote = ' · AI לא זמין: ' + aiError(err);
    }
  }

  /* סדר מילוי טבעי: עמוד, שורה מלמעלה למטה, ובתוך השורה בכיוון הקריאה */
  const rowOf = f => Math.round((f.y + f.h) / 6);
  S.fields.sort((a, b) => (a.page - b.page) || (rowOf(b) - rowOf(a)) ||
                          (a.pdir === 'ltr' ? a.x - b.x : b.x - a.x));
  const kept2 = S.fields;

  UI.progress('מצייר…', 92);
  await Viewer.renderAll();
  UI.progress(null);

  $('#empty').hidden = true;
  ['redetect', 'addmode', 'zoomin', 'zoomout', 'download', 'exportmap']
    .forEach(id => { $('#' + id).disabled = false; });

  const acro = kept2.filter(f => f.src === 'acroform').length;
  const sigs = kept2.filter(f => f.type === 'signature').length;
  $('#docinfo').textContent =
    S.name + '\n' + S.doc.numPages + ' עמודים · ' + kept2.length + ' שדות' +
    (sigs ? ' · ' + sigs + ' בשורות חתימה' : '') + '\n' +
    (acro ? acro + ' שדות טופס אמיתיים' : 'טופס שטוח — זיהוי היוריסטי') + aiNote;

  UI.toast(kept2.length ? 'זוהו ' + kept2.length + ' שדות' + aiNote : 'לא זוהו שדות — אפשר להוסיף ידנית');
  S.loaded = S.name;                 /* סימן לסקריפט הבדיקות שהטעינה הסתיימה */
}

function aiError(err) {
  const st = err && err.status;
  if (st === 401) return 'מפתח API שגוי';
  if (st === 403) return 'אין הרשאה למפתח הזה';
  if (st === 429) return 'עומס — נסה שוב בעוד רגע';
  if (st === 400) return 'הבקשה נדחתה (' + ((err.error && err.error.error && err.error.error.message) || err.message) + ')';
  return (err && err.message) || 'שגיאה';
}

/* ---------------------------------------------------------------
   הגדרות AI
   --------------------------------------------------------------- */
function syncAiButton() {
  const on = window.AI && AI.enabled();
  $('#aibtn').setAttribute('aria-pressed', String(!!on));
  $('#privacy').textContent = on
    ? 'מצב AI פעיל: תמונות העמודים נשלחות ל-Anthropic לבדיקה. בלי AI שום דבר לא יוצא מהמחשב.'
    : 'המסמך נשאר במחשב שלך — שום דבר לא נשלח לשרת.';
}
$('#aibtn').onclick = () => {
  $('#aikey').value = AI.key();
  $('#aion').checked = AI.enabled() || !AI.key();
  $('#aistatus').textContent = '';
  $('#aimodal').hidden = false;
};
$('#aicancel').onclick = () => { $('#aimodal').hidden = true; };
$('#aisave').onclick = async () => {
  const k = $('#aikey').value.trim(), on = $('#aion').checked;
  if (on && k) {
    $('#aistatus').textContent = 'בודק את המפתח…';
    try { await AI.testKey(k); }
    catch (err) { $('#aistatus').textContent = 'המפתח לא עבד: ' + aiError(err); return; }
  }
  AI.configure(k, on);
  $('#aimodal').hidden = true;
  syncAiButton();
  UI.toast(AI.enabled() ? 'AI הופעל — "זהה מחדש" כדי להפעיל על המסמך הפתוח' : 'AI כבוי');
};
syncAiButton();

function carryOver(prev, fields) {
  const overlap = (a, b) => {
    const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    return w > 0 && h > 0 ? w * h / Math.min(a.w * a.h, b.w * b.h) : 0;
  };
  for (const p of prev) {
    const twin = fields.find(f => f.page === p.page && !f.value && overlap(f, p) > 0.5);
    if (twin && p.src !== 'manual') twin.value = p.value;
    else fields.push(Object.assign({}, p, {id: 'f' + (++S.seq)}));
  }
}

/* יציאה מהדף עם טופס ממולא שעוד לא ירד — הדפדפן ישאל קודם */
window.addEventListener('beforeunload', e => {
  if (S.fields.some(f => f.value) && !S.saved) { e.preventDefault(); e.returnValue = ''; }
});

async function openFile(file) {
  if (!file) return;
  try {
    await loadPdf(await file.arrayBuffer(), file.name);
  } catch (err) {
    UI.progress(null);
    S.loaded = 'ERROR: ' + err.message;
    UI.toast('שגיאה בטעינה: ' + err.message);
    console.error(err);
  }
}

/* ---------------------------------------------------------------
   חיווט כפתורים
   --------------------------------------------------------------- */
/* מאפסים את הבחירה — אחרת בחירה חוזרת של אותו קובץ לא מפעילה change */
$('#file').onchange = e => { const f = e.target.files[0]; e.target.value = ''; openFile(f); };

const stage = $('#stage');
stage.addEventListener('dragover', e => { e.preventDefault(); });
stage.addEventListener('drop', e => {
  e.preventDefault();
  const f = e.dataTransfer.files[0];
  if (f && /\.pdf$/i.test(f.name)) openFile(f);
});

/* טפסים לדוגמה: נטענים ישר לאפליקציה. כשהדף נפתח מהדיסק (file://)
   הדפדפן חוסם fetch — אז הקישור פשוט מוריד את הקובץ */
document.querySelectorAll('.examples a').forEach(a => {
  a.addEventListener('click', async e => {
    if (location.protocol === 'file:') return;
    e.preventDefault();
    try {
      const r = await fetch(a.getAttribute('href'));
      if (!r.ok) throw new Error('HTTP ' + r.status);
      await loadPdf(await r.arrayBuffer(), a.dataset.name);
    } catch (err) {
      UI.progress(null);
      UI.toast('לא הצלחתי לטעון את הדוגמה: ' + err.message);
    }
  });
});

$('#redetect').onclick =() => { if (S.bytes) loadPdf(S.bytes, S.name); };

$('#addmode').onclick = () => {
  S.add = !S.add;
  $('#addmode').setAttribute('aria-pressed', String(S.add));
  stage.classList.toggle('adding', S.add);
  if (S.add) UI.toast('גרור על המסמך כדי לסמן שדה');
};

async function setZoom(z) {
  S.zoom = Math.min(3, Math.max(0.5, z));
  $('#zoomlabel').textContent = Math.round(S.zoom * 100) + '%';
  await Viewer.renderAll();
}
$('#zoomin').onclick  = () => setZoom(S.zoom + 0.25);
$('#zoomout').onclick = () => setZoom(S.zoom - 0.25);

$('#exportmap').onclick = () => Exporter.downloadMap(S);

$('#download').onclick = () => {
  Exporter.download(S).catch(err => {
    UI.progress(null);
    UI.toast('שגיאה בייצוא: ' + err.message);
    console.error(err);
  });
};

/* נוח לבדיקות ולדיבוג מהקונסול */
window.__state = S;
})();
