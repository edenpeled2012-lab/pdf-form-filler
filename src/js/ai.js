/* =====================================================================
   ai.js — שכבת AI אופציונלית מעל הזיהוי הגיאומטרי
   הזיהוי הגיאומטרי מוצא *איפה* כותבים בדיוק של נקודה. Claude מסתכל על
   תמונת העמוד עם המועמדים הממוספרים, ומחליט מה הוא שדה אמיתי, מה הסוג
   והשם שלו, ומה פוספס. כבוי כברירת מחדל: רק כשהמשתמש מדליק אותו ומזין
   מפתח API, העמודים נשלחים ל-Anthropic. המפתח נשמר רק בדפדפן הזה.
   ===================================================================== */
"use strict";
window.AI = (function () {

const SDK_URL = 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.131.0/+esm';
const MODEL = 'claude-opus-5-5';
const KEY_STORE = 'pdfform.ai.key', ON_STORE = 'pdfform.ai.on';
const KINDS = ['text', 'date', 'signature', 'checkbox', 'id', 'phone', 'email'];

const store = {
  get(k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } },
  set(k, v) { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch (e) { /* מצב פרטי */ } }
};
const key = () => store.get(KEY_STORE);
const enabled = () => store.get(ON_STORE) === '1' && !!key();
function configure(apiKey, on) {
  store.set(KEY_STORE, (apiKey || '').trim());
  store.set(ON_STORE, on ? '1' : '');
}

let sdk = null;
async function loadSdk() {
  if (!sdk) sdk = import(SDK_URL).then(m => m.default || m.Anthropic);
  return sdk;
}

/* ---------------------------------------------------------------
   תמונת עמוד עם המועמדים ממוספרים עליה
   --------------------------------------------------------------- */
async function pageImage(page, fields) {
  const base = page.getViewport({scale: 1});
  const scale = Math.min(2.2, 1500 / Math.max(base.width, base.height));
  const vp = page.getViewport({scale: scale});
  const cv = document.createElement('canvas');
  cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
  await page.render({canvasContext: ctx, viewport: vp}).promise;

  const boxes = fields.map(f => {
    const q = vp.convertToViewportRectangle([f.x, f.y, f.x + f.w, f.y + f.h]);
    return [Math.min(q[0], q[2]), Math.min(q[1], q[3]), Math.max(q[0], q[2]), Math.max(q[1], q[3])];
  });
  ctx.lineWidth = 2;
  ctx.font = 'bold 13px Arial, sans-serif';
  boxes.forEach((b, i) => {
    ctx.strokeStyle = 'rgba(230,0,80,.9)';
    ctx.strokeRect(b[0], b[1], b[2] - b[0], b[3] - b[1]);
    const tag = String(i + 1), tw = ctx.measureText(tag).width + 6;
    ctx.fillStyle = 'rgba(230,0,80,.95)';
    ctx.fillRect(b[0], b[1] - 15, tw, 15);
    ctx.fillStyle = '#fff';
    ctx.fillText(tag, b[0] + 3, b[1] - 3);
  });
  const norm = b => [b[0] / cv.width, b[1] / cv.height, b[2] / cv.width, b[3] / cv.height].map(v => Math.round(v * 1000));
  const data = cv.toDataURL('image/jpeg', 0.85).split(',')[1];
  return {data: data, vp: vp, W: cv.width, H: cv.height, boxes: boxes.map(norm)};
}

/* ---------------------------------------------------------------
   הבקשה
   --------------------------------------------------------------- */
const SYSTEM =
  'You review automatic field detection on a scanned or digital form page so a person can fill it in on screen. ' +
  'The image shows the page with numbered red boxes: each is a candidate place to write, found by geometry. ' +
  'Coordinates are 0-1000, origin top-left, as [x0, y0, x1, y1].\n' +
  'For every candidate decide whether the person filling the form writes there (keep) or not (decorative line, ' +
  'table header, office-use-only area, instruction text, logo, page frame). Give its kind and a short label in the ' +
  'language of the form (the printed caption the person would read, e.g. "שם פרטי", "Date of birth"). ' +
  'Kinds: text, date, signature, checkbox (also radio/circle-one options), id (national ID / passport / SSN), phone, email.\n' +
  'Then list writing places the candidates missed. Only add a place you can see on the page (a blank line, empty box, ' +
  'empty cell, tick box, blank after a label), with a tight box around the writing area itself, not around its label. ' +
  'Do not add places already covered by a kept candidate. A form with nothing to fill gets keep=false everywhere.';

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['candidates', 'missing'],
  properties: {
    candidates: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['id', 'keep', 'kind', 'label'],
        properties: {
          id: {type: 'integer'},
          keep: {type: 'boolean'},
          kind: {type: 'string', enum: KINDS},
          label: {type: 'string'}
        }
      }
    },
    missing: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['box', 'kind', 'label'],
        properties: {
          box: {type: 'array', items: {type: 'integer'}},
          kind: {type: 'string', enum: KINDS},
          label: {type: 'string'}
        }
      }
    }
  }
};

async function reviewPage(client, page, fields) {
  const img = await pageImage(page, fields);
  const list = fields.map((f, i) => ({id: i + 1, box: img.boxes[i], kind: f.kind, label: f.name || ''}));
  const res = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: {effort: 'medium', format: {type: 'json_schema', schema: SCHEMA}},
    system: SYSTEM,
    messages: [{
      role: 'user',
      content: [
        {type: 'image', source: {type: 'base64', media_type: 'image/jpeg', data: img.data}},
        {type: 'text', text: 'Candidates:\n' + JSON.stringify(list)}
      ]
    }]
  });
  if (res.stop_reason === 'refusal') return null;
  const txt = res.content.filter(b => b.type === 'text').map(b => b.text).join('');
  let out;
  try { out = JSON.parse(txt); } catch (e) { return null; }
  return {out: out, img: img};
}

/* ---------------------------------------------------------------
   יישום ההחלטות על רשימת השדות
   --------------------------------------------------------------- */
function apply(S, pageNum, fields, result, nextId) {
  const {out, img} = result;
  const drop = new Set();
  for (const c of out.candidates || []) {
    const f = fields[c.id - 1];
    if (!f) continue;
    if (!c.keep && f.src !== 'acroform' && f.src !== 'manual' && !f.value) { drop.add(f); continue; }
    if (KINDS.indexOf(c.kind) !== -1 && f.src !== 'acroform') f.kind = c.kind;
    const lab = String(c.label || '').trim();
    if (lab && (!f.name || f.name === 'שדה' || f.src !== 'acroform')) f.name = lab.slice(0, 48);
    f.ai = true;
  }
  const added = [];
  for (const m of out.missing || []) {
    const b = m.box;
    if (!Array.isArray(b) || b.length !== 4) continue;
    const px = [b[0] * img.W / 1000, b[1] * img.H / 1000, b[2] * img.W / 1000, b[3] * img.H / 1000];
    if (px[2] - px[0] < 4 || px[3] - px[1] < 4) continue;
    const p = img.vp.convertToPdfPoint(px[0], px[1]), q = img.vp.convertToPdfPoint(px[2], px[3]);
    const r = {x: Math.min(p[0], q[0]), y: Math.min(p[1], q[1]), w: Math.abs(q[0] - p[0]), h: Math.abs(q[1] - p[1])};
    /* כבר מכוסה בשדה קיים? */
    const covered = fields.concat(added).some(f => {
      const w = Math.min(f.x + f.w, r.x + r.w) - Math.max(f.x, r.x), h = Math.min(f.y + f.h, r.y + r.h) - Math.max(f.y, r.y);
      return w > 0 && h > 0 && w * h > Math.min(f.w * f.h, r.w * r.h) * 0.4;
    });
    if (covered) continue;
    const kind = KINDS.indexOf(m.kind) !== -1 ? m.kind : 'text';
    const name = String(m.label || '').trim().slice(0, 48) || 'שדה';
    added.push({
      id: nextId(), page: pageNum, type: 'form', group: null, role: null, field: name, key: 'ai',
      language: null, direction: null, writing_mode: 'ai', label_text: name, label_bbox: null, cell_bbox: null,
      x: r.x, y: r.y, w: r.w, h: r.h, kind: kind, name: kind === 'checkbox' ? '☐ ' + name : name,
      conf: 0.55, src: 'ai', ai: true, value: '', pdir: fields[0] ? fields[0].pdir : null
    });
  }
  return {drop: drop, added: added};
}

/* כל העמודים, כמה במקביל. onProgress(done, total) */
async function refine(S, onProgress) {
  const Anthropic = await loadSdk();
  const client = new Anthropic({apiKey: key(), dangerouslyAllowBrowser: true, maxRetries: 2});
  const pages = S.pages.map((pg, i) => i + 1);
  let done = 0, failed = 0, firstError = null;
  const drop = new Set(), added = [];
  const nextId = () => 'f' + (++S.seq);
  const work = async n => {
    const fields = S.fields.filter(f => f.page === n);
    try {
      const r = await reviewPage(client, S.pages[n - 1], fields);
      if (r) {
        const a = apply(S, n, fields, r, nextId);
        a.drop.forEach(f => drop.add(f));
        added.push.apply(added, a.added);
      } else failed++;
    } catch (err) {
      failed++;
      if (!firstError) firstError = err;
      /* מפתח שגוי — אין טעם להמשיך לעמודים הבאים */
      if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) throw err;
    }
    onProgress && onProgress(++done, pages.length);
  };
  const queue = pages.slice();
  const runners = Array.from({length: Math.min(3, queue.length)}, async () => {
    while (queue.length) await work(queue.shift());
  });
  await Promise.all(runners);
  S.fields = S.fields.filter(f => !drop.has(f)).concat(added);
  return {dropped: drop.size, added: added.length, failed: failed, error: firstError};
}

/* בדיקת מפתח זולה: בקשה קטנה בלי תמונה */
async function testKey(apiKey) {
  const Anthropic = await loadSdk();
  const client = new Anthropic({apiKey: apiKey, dangerouslyAllowBrowser: true, maxRetries: 0});
  await client.messages.create({model: MODEL, max_tokens: 16, messages: [{role: 'user', content: 'ping'}]});
  return true;
}

return {enabled: enabled, key: key, configure: configure, refine: refine, testKey: testKey,
        loadSdk: loadSdk, _apply: apply, _pageImage: pageImage,
        /* לבדיקות: SDK מדומה */
        _setSdk: f => { sdk = Promise.resolve(f); }};
})();
