/* =====================================================================
   export.js — בניית ה-PDF החדש
   כל ערך מוטבע כתמונת PNG: טקסט מרונדר ב-canvas (ככה העברית
   וה-bidi יוצאים מושלמים), חתימה היא ממילא ציור.
   ===================================================================== */
"use strict";
window.Exporter = (function () {

async function build(S) {
  const filled = S.fields.filter(f => f.value);

  /* גודל כתב אחד לכל המסמך: לפי הגובה האופייני של שורת כתיבה בטופס */
  const hs = S.fields.filter(f => f.kind !== 'checkbox' && f.kind !== 'signature' && !f.slots && f.h < 40)
    .map(f => f.h).sort((a, b) => a - b);
  const docPt = Math.max(8, Math.min(11, (hs.length ? hs[hs.length >> 1] : 14) * 0.72));
  if (!filled.length) { UI.toast('לא מילאת כלום עדיין'); return null; }

  UI.progress('בונה PDF…', 15);
  const doc = await PDFLib.PDFDocument.load(S.bytes, {ignoreEncryption: true});

  /* משטחים קודם את שדות הטופס המקוריים, כדי שתיבות ריקות
     לא יכסו את מה שנטביע אחריהן. */
  try {
    const form = doc.getForm();
    if (form.getFields().length) form.flatten();
  } catch (e) {
    console.warn('flatten נכשל, ממשיכים', e);
  }

  const pages = doc.getPages();
  let i = 0;
  for (const f of filled) {
    UI.progress('מטביע ' + f.name + '…', 15 + 75 * (++i) / filled.length);
    const p = pages[f.page - 1];
    if (!p) continue;

    /* משבצות: כל תו בתיבה שלו, משמאל לימין כמו שכותבים ספרות */
    if (f.slots && f.kind !== 'signature') {
      const chars = Array.from(String(f.value).replace(/\s+/g, ''));
      for (let k = 0; k < chars.length && k < f.slots.length - 1; k++) {
        const x0 = f.slots[k], sw = f.slots[k + 1] - x0;
        const img = await doc.embedPng(UI.rasterChar(chars[k], sw, f.h));
        p.drawImage(img, {x: x0, y: f.y, width: sw, height: f.h});
      }
      continue;
    }

    const url = f.kind === 'signature' ? f.value
              : f.kind === 'checkbox'  ? UI.rasterCheck(f.w, f.h)
              : UI.rasterText(f.value, f.w, f.h, docPt);

    const img = await doc.embedPng(url);
    let w = f.w, h = f.h;

    /* חתימה וסימון שומרים על יחס הגובה-רוחב שלהם */
    if (f.kind === 'signature' || f.kind === 'checkbox') {
      const ar = img.width / img.height;
      h = Math.min(f.h, f.w / ar);
      w = h * ar;
      if (w > f.w) { w = f.w; h = w / ar; }
    }
    p.drawImage(img, {
      x: f.x + (f.w - w) / 2,
      y: f.y + (f.h - h) / 2,
      width: w, height: h
    });
  }

  UI.progress('שומר…', 95);
  const bytes = await doc.save();
  UI.progress(null);
  return bytes;
}

async function download(S) {
  const bytes = await build(S);
  if (!bytes) return;
  const blob = new Blob([bytes], {type: 'application/pdf'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = S.name.replace(/\.pdf$/i, '') + ' - ממולא.pdf';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  S.saved = true;
  UI.toast('הקובץ ירד');
}

/* ---------------------------------------------------------------
   מפת שדות JSON — אותו מבנה כמו detected_fields.json של
   importpdf.py, כדי ששני הכלים יהיו תואמים.
   --------------------------------------------------------------- */
const r2 = n => Math.round(n * 100) / 100;

function rectOut(r) {
  if (!r) return null;
  return {
    x0: r2(r.x), y0: r2(r.y), x1: r2(r.x + r.w), y1: r2(r.y + r.h),
    width: r2(r.w), height: r2(r.h)
  };
}

function fieldMap(S) {
  return S.fields.map(f => ({
    type: f.type || 'form',
    page: f.page,
    group: f.group == null ? null : f.group,
    role: f.role || null,
    field: f.field || f.name,
    key: f.key || null,
    kind: f.kind,
    language: f.language || null,
    direction: f.direction || null,
    writing_mode: f.writing_mode || null,
    confidence: f.conf,
    label_text: f.label_text || '',
    label_bbox: rectOut(f.label_bbox),
    cell_bbox: rectOut(f.cell_bbox),
    writing_bbox: rectOut(f),
    slots: f.slots ? f.slots.map(r2) : null,
    filled: !!f.value
  }));
}

function downloadMap(S) {
  if (!S.fields.length) { UI.toast('אין שדות לייצוא'); return; }
  const json = JSON.stringify(fieldMap(S), null, 2);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([json], {type: 'application/json'}));
  a.download = S.name.replace(/\.pdf$/i, '') + ' - fields.json';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  UI.toast('מפת השדות ירדה');
}

return {build, download, fieldMap, downloadMap};
})();
