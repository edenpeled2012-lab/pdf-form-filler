/* =====================================================================
   detect.js — מנוע הזיהוי
   מבוסס על האלגוריתם של importpdf.py (PyMuPDF), מותאם ל-pdf.js.

   סדר העדיפויות של אזור הכתיבה:
     תא בטבלה  >  רצף קו תחתון  >  קו ציורי  >  רווח ריק

   כל הקואורדינטות ב-user space של PDF: מקור שמאל-למטה, נקודות,
   לפני סיבוב העמוד. מלבן = {x, y, w, h} כאשר y הוא הקצה התחתון.
   ===================================================================== */
"use strict";
window.Detect = (function () {

/* =================================================================
   1. נרמול טקסט
   ================================================================= */
const HEB  = /[֐-׿]/;
const RTL_ANY = /[֐-׿؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/;   /* עברית, ערבית, וצורות התצוגה של ערבית */
const FILL = /[_․…]/;              /* תווים שמציירים שורת כתיבה */
const BIDI = /[‎‏‪-‮⁦-⁩﻿]/g;

function normalizeText(s) {
  return String(s == null ? '' : s)
    .replace(BIDI, '')
    .replace(/：/g, ':').replace(/[׳’]/g, "'").replace(/״/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

/* הסרת ניקוד עברי, תנועות ערביות ו-tatweel, בלי לפגוע באותיות עצמן */
function normalizeForMatching(s) {
  return normalizeText(s)
    .replace(/[֑-ׇؐ-ؚـً-ٰٟ]/g, '')
    .replace(/[:'"׳’]/g, '')
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .trim();
}

const stripFill = s => normalizeText(s).replace(/[_․….\-–—]+/g, ' ').trim();

/* =================================================================
   2. מילוני תוויות — עברית, אנגלית, ערבית, אמהרית
   ================================================================= */
const FORM_FIELDS = [
  {field:'First Name', key:'first_name', kind:'text', name:'שם פרטי', phrases:[
    {t:'שם פרטי', lang:'he', dir:'rtl'},
    {t:'First Name', lang:'en', dir:'ltr'}, {t:'Given Name', lang:'en', dir:'ltr'},
    {t:'الاسم الأول', lang:'ar', dir:'rtl'}, {t:'الاسم الشخصي', lang:'ar', dir:'rtl'},
    {t:'የመጀመሪያ ስም', lang:'am', dir:'ltr'}]},

  {field:'Last Name', key:'last_name', kind:'text', name:'שם משפחה', phrases:[
    {t:'שם משפחה', lang:'he', dir:'rtl'},
    {t:'Last Name', lang:'en', dir:'ltr'}, {t:'Family Name', lang:'en', dir:'ltr'},
    {t:'Surname', lang:'en', dir:'ltr'},
    {t:'اسم العائلة', lang:'ar', dir:'rtl'}, {t:'اللقب', lang:'ar', dir:'rtl'},
    {t:'የአያት ስም', lang:'am', dir:'ltr'}, {t:'የቤተሰብ ስም', lang:'am', dir:'ltr'}]},

  {field:'ID Number', key:'id_number', kind:'id', name:'תעודת זהות', phrases:[
    {t:"מס' תעודת זהות", lang:'he', dir:'rtl'}, {t:'מס תעודת זהות', lang:'he', dir:'rtl'},
    {t:'תעודת זהות', lang:'he', dir:'rtl'}, {t:'ת.ז', lang:'he', dir:'rtl'},
    {t:'ID Number', lang:'en', dir:'ltr'}, {t:'Identity Number', lang:'en', dir:'ltr'},
    {t:'National ID', lang:'en', dir:'ltr'},
    {t:'رقم الهوية', lang:'ar', dir:'rtl'}, {t:'رقم بطاقة الهوية', lang:'ar', dir:'rtl'},
    {t:'የመታወቂያ ቁጥር', lang:'am', dir:'ltr'}, {t:'መታወቂያ ቁጥር', lang:'am', dir:'ltr'}]},

  {field:'Address', key:'address', kind:'text', name:'כתובת', phrases:[
    {t:'כתובת', lang:'he', dir:'rtl'},
    {t:'Address', lang:'en', dir:'ltr'},
    {t:'العنوان', lang:'ar', dir:'rtl'}, {t:'عنوان', lang:'ar', dir:'rtl'},
    {t:'አድራሻ', lang:'am', dir:'ltr'}]},

  {field:'Phone', key:'phone', kind:'phone', name:'טלפון', phrases:[
    {t:'טלפון', lang:'he', dir:'rtl'}, {t:'נייד', lang:'he', dir:'rtl'},
    {t:'Phone', lang:'en', dir:'ltr'}, {t:'Mobile', lang:'en', dir:'ltr'},
    {t:'هاتف', lang:'ar', dir:'rtl'}, {t:'ስልክ', lang:'am', dir:'ltr'}]},

  {field:'Email', key:'email', kind:'email', name:'אימייל', phrases:[
    {t:'דואר אלקטרוני', lang:'he', dir:'rtl'}, {t:'דוא"ל', lang:'he', dir:'rtl'},
    {t:'Email', lang:'en', dir:'ltr'}, {t:'E-mail', lang:'en', dir:'ltr'},
    {t:'البريد الإلكتروني', lang:'ar', dir:'rtl'}, {t:'ኢሜይል', lang:'am', dir:'ltr'}]}
];

/* שורת חתימה = שם + חתימה + תאריך יחד באותה שורה */
const SIGNATURE_ALIASES = {
  Name:      {kind:'text',      name:'שם',    phrases:[
    {t:'שם', lang:'he', dir:'rtl'}, {t:'Name', lang:'en', dir:'ltr'},
    {t:'الاسم', lang:'ar', dir:'rtl'}, {t:'اسم', lang:'ar', dir:'rtl'}, {t:'ስም', lang:'am', dir:'ltr'}]},
  Signature: {kind:'signature', name:'חתימה', phrases:[
    {t:'חתימה', lang:'he', dir:'rtl'}, {t:'Signature', lang:'en', dir:'ltr'},
    {t:'التوقيع', lang:'ar', dir:'rtl'}, {t:'توقيع', lang:'ar', dir:'rtl'}, {t:'ፊርማ', lang:'am', dir:'ltr'}]},
  Date:      {kind:'date',      name:'תאריך', phrases:[
    {t:'תאריך', lang:'he', dir:'rtl'}, {t:'Date', lang:'en', dir:'ltr'},
    {t:'التاريخ', lang:'ar', dir:'rtl'}, {t:'تاريخ', lang:'ar', dir:'rtl'}, {t:'ቀን', lang:'am', dir:'ltr'}]}
};
const SIG_ORDER = ['Name', 'Signature', 'Date'];

const ROLE_ALIASES = {
  'המשתתף':        ['המשתתף', 'Participant', 'المشارك', 'ተሳታፊ'],
  'החוקר המסביר':  ['החוקר המסביר', 'Explaining Researcher', 'الباحث الشارح', 'አብራሪ ተመራማሪ'],
  'עד בלתי תלוי':  ['עד בלתי תלוי', 'Independent Witness', 'شاهد مستقل', 'ገለልተኛ ምስክር']
};

/* התאמה מדויקת — למילה בודדת בשורת חתימה */
function matchSignatureLabel(text) {
  const norm = normalizeForMatching(stripFill(text));
  if (!norm) return null;
  for (const field of SIG_ORDER) {
    for (const p of SIGNATURE_ALIASES[field].phrases) {
      if (norm === normalizeForMatching(p.t)) {
        return {field: field, language: p.lang, direction: p.dir,
                kind: SIGNATURE_ALIASES[field].kind, name: SIGNATURE_ALIASES[field].name};
      }
    }
  }
  return null;
}

/* התאמה בהכלה — לתווית של שדה טופס רגיל */
function matchFormLabel(text) {
  const norm = normalizeForMatching(stripFill(text));
  if (!norm) return null;
  let best = null;
  for (const def of FORM_FIELDS) {
    for (const p of def.phrases) {
      const np = normalizeForMatching(p.t);
      if (np && norm.indexOf(np) !== -1) {
        /* הביטוי הארוך ביותר מנצח: "שם משפחה" גובר על "שם" */
        if (!best || np.length > best.len) {
          best = {def: def, language: p.lang, direction: p.dir, phrase: p.t, len: np.length};
        }
      }
    }
  }
  return best;
}

/* כותרת תפקיד היא פריט טקסט שלם — התאמה מדויקת, לא תחילית.
   אחרת "המשתתף הבין את הנאמר..." מגוף הטקסט נחשב כותרת. */
function matchRole(text) {
  const norm = normalizeForMatching(String(text).replace(/[\s:：*]+$/, ''));
  if (!norm) return null;
  for (const role in ROLE_ALIASES) {
    for (const alias of ROLE_ALIASES[role]) {
      if (norm === normalizeForMatching(alias)) return role;
    }
  }
  return null;
}

/* =================================================================
   3. גיאומטריה
   ================================================================= */
const mat = (a, b) => [
  a[0]*b[0] + a[1]*b[2],  a[0]*b[1] + a[1]*b[3],
  a[2]*b[0] + a[3]*b[2],  a[2]*b[1] + a[3]*b[3],
  a[4]*b[0] + a[5]*b[2] + b[4],  a[4]*b[1] + a[5]*b[3] + b[5]
];

function inter(a, b) {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return (w > 0 && h > 0) ? w * h : 0;
}
const overlapRatio = (a, b) => {
  const i = inter(a, b);
  return i ? i / Math.min(a.w * a.h, b.w * b.h) : 0;
};
const xOverlap = (a, b) =>
  Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));

/* אזור כתיבה חייב להיות ריק מטקסט. רצפי "____" אינם טקסט —
   הם בדיוק המקום לכתוב בו. */
function isEmpty(r, texts, tol) {
  if (r.w <= 4 || r.h <= 4) return false;
  const area = r.w * r.h;
  let cov = 0;
  for (const t of texts) {
    if (t.isFill) continue;
    cov += inter(r, {x: t.x, y: t.bot, w: t.w, h: t.top - t.bot});
    if (cov > area * (tol || 0.10)) return false;
  }
  return true;
}

/* =================================================================
   4. טקסט — כולל פיצול פריטים מעורבים
   בטפסים עבריים התווית והשורה הן לעתים אותו פריט אחד:
   "__________:חתימה________". המחרוזת בסדר חזותי (שמאל לימין
   כפי שצוירה), ולכן פרוסה יחסית לפי רוחב נמדד נותנת מיקום נכון.
   ================================================================= */
const MEASURE = document.createElement('canvas').getContext('2d');

function splitRuns(str, box) {
  const runs = [];
  let cur = null;
  /* "____", "……", "......" (4+ נקודות) ו-"ـــــ" (תטוויל ערבי) — כולם שורות כתיבה */
  const chars = Array.from(str);
  const mask = new Array(chars.length).fill(false);
  const flat = chars.join('');
  const re = /[_‗․…]+|\.{4,}|ـ{3,}/g;
  let mm, idx = 0;
  const offs = [];
  for (const c of chars) { offs.push(idx); idx += c.length; }
  while ((mm = re.exec(flat))) {
    for (let k = 0; k < chars.length; k++) if (offs[k] >= mm.index && offs[k] < mm.index + mm[0].length) mask[k] = true;
  }
  let ci = 0;
  for (const ch of chars) {
    const isFillCh = mask[ci++] || !!(cur && cur.fill && /[\s.]/.test(ch));
    if (!cur || cur.fill !== isFillCh) { cur = {fill: isFillCh, s: ch}; runs.push(cur); }
    else cur.s += ch;
  }
  const long = r => r.fill && r.s.replace(/\s/g, '').length >= 3;

  if (runs.length === 1) {
    return [Object.assign({}, box, {str: str, isFill: long(runs[0])})];
  }
  if (!runs.some(long)) {
    return [Object.assign({}, box, {str: str, isFill: false})];
  }

  /* באיזה סדר המחרוזת מגיעה? מפיקי PDF שונים כותבים עברית אחרת.
     הנקודתיים הן הסימן: בעברית כותבים "חתימה:", ובתצוגה RTL
     הנקודתיים מופיעות משמאל למילה. לכן אם במחרוזת הנקודתיים
     מופיעות *לפני* האותיות — המחרוזת בסדר חזותי. אם *אחרי* —
     בסדר לוגי, והפריסה על הציר הפוכה.
       "__________:חתימה________"  → חזותי
       "חתימה:__________"          → לוגי */
  const logical = /[֐-׿؀-ۿ]\s*[:：]/.test(str) &&
                  !/[:：]\s*[֐-׿؀-ۿ]/.test(str);
  const order = logical ? runs.slice().reverse() : runs;

  /* מודדים כדי לקבל פרופורציות אמיתיות — קו תחתון רחב מאות עברית */
  MEASURE.font = Math.max(6, box.h) + 'px Arial, sans-serif';
  const widths = order.map(r => Math.max(0.5, MEASURE.measureText(r.s).width));
  const total = widths.reduce((a, b) => a + b, 0) || 1;

  const out = [];
  let x = box.x;
  for (let i = 0; i < order.length; i++) {
    const w = box.w * (widths[i] / total);
    if (order[i].s.trim()) {
      out.push(Object.assign({}, box, {
        str: order[i].s, x: x, w: w, isFill: long(order[i]), fromMixed: true
      }));
    }
    x += w;
  }
  return out;
}

function textBoxes(tc) {
  const out = [];
  let n = 0;
  for (const it of tc.items) {
    n++;
    if (!it.str || !it.str.trim()) continue;
    const m = it.transform;
    const h = Math.abs(it.height) > 0.6 ? it.height : (Math.hypot(m[2], m[3]) || 10);
    /* טקסט מסובב (כיתוב לאורך השוליים): התיבה האמיתית אנכית, והוא לא תווית */
    if (Math.abs(m[1]) > Math.abs(m[0]) * 2) {
      const len = it.width || 0, up = m[1] > 0;
      const x0 = up ? m[4] - h * 0.85 : m[4] - h * 0.22;
      out.push({x: x0, y: up ? m[5] : m[5] - len, w: h * 1.07, h: len, base: up ? m[5] : m[5] - len,
                top: up ? m[5] + len : m[5], bot: up ? m[5] : m[5] - len,
                str: it.str, isFill: false, rotated: true, rtl: RTL_ANY.test(it.str), item: n});
      continue;
    }
    const base = {
      x: m[4], y: m[5], w: it.width || 0, h: h, base: m[5],
      top: m[5] + h * 0.85, bot: m[5] - h * 0.22, rtl: RTL_ANY.test(it.str), item: n
    };
    for (const part of splitRuns(it.str, base)) out.push(part);
  }
  return out;
}

/* מיקום מדויק לחלקים של פריט מעורב, לפי רצפי ה-"____" שנמצאו
   בפקודות הציור. ההערכה של splitRuns נשארת רק כשאין התאמה. */
function refineWithGlyphs(texts, fills) {
  if (!fills.length) return texts;
  const groups = new Map();
  for (const t of texts) {
    if (!groups.has(t.item)) groups.set(t.item, []);
    groups.get(t.item).push(t);
  }
  const out = [];
  for (const parts of groups.values()) {
    const p0 = parts[0];
    const x0 = Math.min.apply(null, parts.map(p => p.x));
    const x1 = Math.max.apply(null, parts.map(p => p.x + p.w));
    const fs = fills.filter(f => Math.abs(f.y - p0.base) <= Math.max(2, p0.h * 0.3) &&
                                 f.x >= x0 - 2 && f.x + f.w <= x1 + 2).sort((a, b) => a.x - b.x);
    if (!fs.length) { out.push.apply(out, parts); continue; }
    const gaps = [];
    let cur = x0;
    for (const f of fs) {
      if (f.x - cur > 1.5) gaps.push({x: cur, w: f.x - cur});
      cur = Math.max(cur, f.x + f.w);
    }
    if (x1 - cur > 1.5) gaps.push({x: cur, w: x1 - cur});
    const words = parts.filter(p => !p.isFill && p.str.replace(/[._‗․…ـ\s]/g, '')).sort((a, b) => a.x - b.x);
    if (words.length === gaps.length) words.forEach((w, i) => { w.x = gaps[i].x; w.w = gaps[i].w; });
    out.push.apply(out, words);
    for (const f of fs) out.push(Object.assign({}, p0, {str: '____', x: f.x, w: f.w, isFill: true, fromMixed: true}));
  }
  return out;
}

/* רצפי קו תחתון סמוכים על אותה שורה = שורת כתיבה אחת */
function underlineSegments(texts) {
  const segs = texts.filter(t => t.isFill && t.w >= 6)
    .map(t => ({x: t.x, w: t.w, y: t.base, h: t.h}))
    .sort((a, b) => (a.y - b.y) || (a.x - b.x));
  /* קודם שורות (בסבולת של 2nt), ורק אז מיון לפי x בתוך השורה —
     אחרת הפרש זעיר ב-y מערבב את הסדר וקטע אחד "בולע" את השכן שלו */
  const rows = [];
  for (const s of segs) {
    const row = rows.find(r => Math.abs(r.y - s.y) <= 2);
    if (row) row.items.push(s); else rows.push({y: s.y, items: [s]});
  }
  const out = [];
  for (const row of rows) {
    let p = null;
    for (const s of row.items.sort((a, b) => a.x - b.x)) {
      if (p && s.x <= p.x + p.w + 4) p.w = Math.max(p.x + p.w, s.x + s.w) - p.x;
      else { p = Object.assign({}, s); out.push(p); }
    }
  }
  return out;
}

/* =================================================================
   5. ציור — קווים אופקיים, אנכיים ומלבנים
   ================================================================= */
function graphics(ops) {
  const O = pdfjsLib.OPS;
  let ctm = [1, 0, 0, 1, 0, 0];
  const stack = [], hLines = [], vLines = [], rects = [], ul = [], ticks = [], images = [], art = [];
  const tp = (x, y) => [ctm[0]*x + ctm[2]*y + ctm[4], ctm[1]*x + ctm[3]*y + ctm[5]];

  /* צורה נכנסת לרשימות רק כשהיא נצבעת בפועל. נתיב שמסתיים ב-n
     הוא חיתוך (clip) ולא נראה; מלבן לבן על דף לבן — גם לא. */
  let pending = [];
  /* קו של צורה סגורה (מסגרת, מסגרת מעוגלת) שייך לטבלה — לא קו כתיבה */
  const commitSeg = (p, q, shape) => {
    const dy = Math.abs(p[1] - q[1]), dx = Math.abs(p[0] - q[0]);
    if (dy <= 1.5 && dx >= 10) {
      const l = {x0: Math.min(p[0], q[0]), x1: Math.max(p[0], q[0]), y: (p[1] + q[1]) / 2};
      hLines.push(l);
      if (!shape) ul.push(l);
    } else if (dx <= 1.5 && dy >= 3) {
      const l = {y0: Math.min(p[1], q[1]), y1: Math.max(p[1], q[1]), x: (p[0] + q[0]) / 2};
      if (dy >= 8) vLines.push(l);
      if (dy <= 30) ticks.push(l);
    }
  };
  const rectEdges = r => {
    if (r.w >= 10) {
      hLines.push({x0: r.x, x1: r.x + r.w, y: r.y});
      hLines.push({x0: r.x, x1: r.x + r.w, y: r.y + r.h});
    }
    if (r.h >= 8) {
      vLines.push({y0: r.y, y1: r.y + r.h, x: r.x});
      vLines.push({y0: r.y, y1: r.y + r.h, x: r.x + r.w});
    }
  };
  const whiteRects = [];

  /* מצב הטקסט — כדי לדעת היכן בדיוק נמצא כל תו. pdf.js מחזיר שורה
     שלמה כפריט אחד, ו"חתימה:________" לא מגלה איפה הקו מתחיל. */
  const fills = [];
  let tm = [1, 0, 0, 1, 0, 0], tlm = tm, tx = 0;
  let fontSize = 10, charSp = 0, wordSp = 0, hScale = 1, leading = 0, rise = 0;
  /* כמה תווים נראים וכמה שקופים (מצב 3/7 — שכבת OCR מעל סריקה) */
  let renderMode = 0, glyphsShown = 0, glyphsHidden = 0;
  let fillColor = [0, 0, 0], strokeColor = [0, 0, 0];
  const cstack = [];
  const lumOf = c => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
  const moveText = (x, y) => {
    tlm = [tlm[0], tlm[1], tlm[2], tlm[3], x * tlm[0] + y * tlm[2] + tlm[4], x * tlm[1] + y * tlm[3] + tlm[5]];
    tm = tlm; tx = 0;
  };
  const textPt = x => tp(x * hScale * tm[0] + rise * tm[2] + tm[4], x * hScale * tm[1] + rise * tm[3] + tm[5]);
  const showGlyphs = glyphs => {
    const horiz = Math.abs(tm[1]) < 1e-3 && Math.abs(ctm[1]) < 1e-3 && tm[0] * ctm[0] > 0;
    const size = Math.abs(fontSize) * Math.hypot(tm[2], tm[3]) * Math.hypot(ctm[2], ctm[3]);
    let run = null;
    const end = () => {
      if (run && run.n >= (run.ch === '.' ? 4 : run.ch === 'ـ' ? 3 : 2)) {
        const p = textPt(run.x0), q = textPt(run.x1);
        fills.push({x: Math.min(p[0], q[0]), w: Math.abs(q[0] - p[0]), y: p[1], h: size || 10});
      }
      run = null;
    };
    for (const g of glyphs) {
      if (g && typeof g === 'object' && g.unicode && g.unicode.trim()) {
        if (renderMode === 3 || renderMode === 7) glyphsHidden++; else glyphsShown++;
      }
      if (typeof g === 'number') {
        if (Math.abs(g) > 300) end();                 /* רווח גדול באמצע — שני קווים נפרדים */
        tx -= g * fontSize / 1000;
        continue;
      }
      if (!g) continue;
      const u = g.unicode || '';
      const adv = (g.width || 0) * fontSize / 1000 + charSp + (g.isSpace ? wordSp : 0);
      const ch = (u === '_' || u === '‗') ? '_' : (u === '…' || u === '․' || u === '.') ? '.' : u === 'ـ' ? 'ـ' : null;
      if (horiz && ch) {
        if (run && run.ch !== ch) end();
        if (!run) run = {x0: tx, n: 0, ch: ch};
        run.n++; run.x1 = tx + adv;
      } else end();
      tx += adv;
    }
    end();
  };
  const FILL_OPS = new Set([O.fill, O.eoFill, O.fillStroke, O.eoFillStroke, O.closeFillStroke, O.closeEOFillStroke]);
  const STROKE_OPS = new Set([O.stroke, O.closeStroke, O.fillStroke, O.eoFillStroke, O.closeFillStroke, O.closeEOFillStroke]);
  const parseColor = a => {
    if (typeof a[0] === 'string') {
      const h = a[0].replace('#', '');
      return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    }
    return [a[0], a[1], a[2]].map(v => v <= 1 ? v * 255 : v);
  };

  let dashed = false;
  const paint = f => {
    const stroked = STROKE_OPS.has(f) && lumOf(strokeColor) < 245;
    const filled = FILL_OPS.has(f);
    const flum = lumOf(fillColor);
    for (const it of pending) {
      if (it.art) {
        /* צורה מעוקלת מלאה: אות או לוגו מצוירים כווקטור — "דיו" שאינו טקסט */
        if (filled && flum < 200) art.push(it.art);
        continue;
      }
      if (it.rect) {
        const r = it.rect;
        if (filled) { r.filled = true; r.lum = flum; }
        if (stroked) r.stroked = true;
        if (!filled && !stroked) continue;
        rects.push(r);
        if (stroked || flum < 245) {
          if (r.h <= 2.5 && r.w >= 10) ul.push({x0: r.x, x1: r.x + r.w, y: r.y + r.h / 2});
          if (r.w <= 2.5 && r.h >= 3 && r.h <= 30) ticks.push({y0: r.y, y1: r.y + r.h, x: r.x + r.w / 2});
          rectEdges(r);
        } else whiteRects.push(r);
      } else if (stroked || (filled && flum < 200)) {
        commitSeg(it.p, it.q, it.sp.n > 2 || it.sp.curved);
      }
    }
    pending = [];
  };

  for (let i = 0; i < ops.fnArray.length; i++) {
    const f = ops.fnArray[i], a = ops.argsArray[i];
    if (f === O.save) { stack.push(ctm.slice()); cstack.push([fillColor, strokeColor, dashed]); }
    else if (f === O.restore) {
      if (stack.length) ctm = stack.pop();
      if (cstack.length) { const c = cstack.pop(); fillColor = c[0]; strokeColor = c[1]; dashed = c[2]; }
    }
    else if (f === O.transform) ctm = mat(a, ctm);
    else if (f === O.setFillRGBColor) fillColor = parseColor(a);
    else if (f === O.setStrokeRGBColor) strokeColor = parseColor(a);
    else if (f === O.setFillGray) fillColor = [a[0] * 255, a[0] * 255, a[0] * 255];
    else if (f === O.setStrokeGray) strokeColor = [a[0] * 255, a[0] * 255, a[0] * 255];
    else if (FILL_OPS.has(f) || STROKE_OPS.has(f)) paint(f);
    else if (f === O.endPath) pending = [];
    else if (f === O.setDash) dashed = !!(a[0] && a[0].length && a[0].some(v => v > 0));
    else if (f === O.paintImageXObject || f === O.paintInlineImageXObject || f === O.paintImageMaskXObject) {
      const p = tp(0, 0), q = tp(1, 1);
      images.push({x: Math.min(p[0], q[0]), y: Math.min(p[1], q[1]), w: Math.abs(q[0] - p[0]), h: Math.abs(q[1] - p[1])});
    }
    else if (f === O.beginText) { tm = tlm = [1, 0, 0, 1, 0, 0]; tx = 0; }
    else if (f === O.setFont) fontSize = a[1] || fontSize;
    else if (f === O.setTextMatrix) { tm = tlm = (a.length === 6 ? a : a[0]).slice(); tx = 0; }
    else if (f === O.moveText) moveText(a[0], a[1]);
    else if (f === O.setLeadingMoveText) { leading = -a[1]; moveText(a[0], a[1]); }
    else if (f === O.nextLine) moveText(0, -leading);
    else if (f === O.setLeading) leading = a[0];
    else if (f === O.setCharSpacing) charSp = a[0];
    else if (f === O.setWordSpacing) wordSp = a[0];
    else if (f === O.setHScale) hScale = a[0] / 100;
    else if (f === O.setTextRise) rise = a[0];
    else if (f === O.setTextRenderingMode) renderMode = a[0];
    else if (f === O.showText || f === O.showSpacedText) showGlyphs(a[0]);
    else if (f === O.nextLineShowText) { moveText(0, -leading); showGlyphs(a[0]); }
    else if (f === O.nextLineSetSpacingShowText) { wordSp = a[0]; charSp = a[1]; moveText(0, -leading); showGlyphs(a[2]); }
    else if (f === O.constructPath) {
      const sub = a[0], co = a[1];
      if (sub.some(op => op === O.curveTo || op === O.curveTo2 || op === O.curveTo3)) {
        let ax0 = 1e9, ay0 = 1e9, ax1 = -1e9, ay1 = -1e9;
        for (let j = 0; j + 1 < co.length; j += 2) {
          const p = tp(co[j], co[j + 1]);
          ax0 = Math.min(ax0, p[0]); ax1 = Math.max(ax1, p[0]); ay0 = Math.min(ay0, p[1]); ay1 = Math.max(ay1, p[1]);
        }
        if (ax1 - ax0 < 60 && ay1 - ay0 < 60) pending.push({art: {x: ax0, y: ay0, w: ax1 - ax0, h: ay1 - ay0}});
      }
      let k = 0, cur = null, start = null, sp = {n: 0, curved: false};
      for (let j = 0; j < sub.length; j++) {
        const op = sub[j];
        if (op === O.moveTo)      { cur = tp(co[k], co[k+1]); k += 2; start = cur; sp = {n: 0, curved: false}; }
        else if (op === O.lineTo) { const n = tp(co[k], co[k+1]); k += 2; if (cur) { sp.n++; pending.push({p: cur, q: n, sp: sp}); } cur = n; }
        else if (op === O.curveTo){ cur = tp(co[k+4], co[k+5]); k += 6; sp.curved = true; }
        else if (op === O.curveTo2 || op === O.curveTo3) { cur = tp(co[k+2], co[k+3]); k += 4; sp.curved = true; }
        else if (op === O.closePath) { if (cur && start) { sp.n++; pending.push({p: cur, q: start, sp: sp}); } cur = start; }
        else if (op === O.rectangle) {
          const p1 = tp(co[k], co[k+1]);
          const p2 = tp(co[k] + co[k+2], co[k+1] + co[k+3]);
          k += 4;
          pending.push({rect: {x: Math.min(p1[0], p2[0]), y: Math.min(p1[1], p2[1]),
                               w: Math.abs(p2[0] - p1[0]), h: Math.abs(p2[1] - p1[1])}});
          cur = p1; start = p1;
        }
      }
    }
  }

  /* מלבן לבן נראה רק כשהוא יושב על רקע כהה יותר (תאים לבנים בתוך מסגרת אפורה) */
  for (const r of whiteRects) {
    const onDark = rects.some(q => q !== r && q.filled && q.lum < 235 &&
                                   q.x <= r.x + 1 && q.y <= r.y + 1 &&
                                   q.x + q.w >= r.x + r.w - 1 && q.y + q.h >= r.y + r.h - 1);
    if (onDark) rectEdges(r);
  }
  return {h: mergeH(hLines), v: mergeV(vLines), rects: rects, ul: mergeH(ul), ticks: ticks,
          fills: fills, images: images, art: art, glyphsShown: glyphsShown, glyphsHidden: glyphsHidden};
}

/* =================================================================
   5ב. קווים מתוך תמונה — לטופס סרוק
   בסריקה אין פקודות ציור: כל הדף הוא תמונה אחת (לפעמים עם שכבת
   טקסט שקופה מ-OCR). מציירים את העמוד ומחפשים בפיקסלים רצפים
   כהים ארוכים ודקים — אופקיים ואנכיים — בדיוק כמו שהעין רואה.
   ================================================================= */
async function rasterLines(page) {
  const SC = 2;
  const vp = page.getViewport({scale: SC, rotation: 0});
  const W = Math.floor(vp.width), H = Math.floor(vp.height);
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d', {willReadFrequently: true});
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
  await page.render({canvasContext: ctx, viewport: vp}).promise;
  const px = ctx.getImageData(0, 0, W, H).data;
  const dark = new Uint8Array(W * H);
  for (let i = 0, j = 0; i < dark.length; i++, j += 4) {
    dark[i] = (px[j] * 0.299 + px[j + 1] * 0.587 + px[j + 2] * 0.114) < 185 ? 1 : 0;
  }

  /* רצפים אופקיים: אורך ≥ 15pt, ואז איחוד שורות סמוכות לקו אחד */
  const minH = 15 * SC, runsH = [];
  for (let y = 0; y < H; y++) {
    let x = 0;
    while (x < W) {
      if (!dark[y * W + x]) { x++; continue; }
      let e = x, gap = 0;
      while (e + 1 < W && (dark[y * W + e + 1] || (gap < 2 && dark[y * W + Math.min(W - 1, e + 2)]))) {
        gap = dark[y * W + e + 1] ? 0 : gap + 1; e++;
      }
      if (e - x + 1 >= minH) runsH.push({y: y, x0: x, x1: e});
      x = e + 1;
    }
  }
  /* איחוד: רק מול הקווים שהיו פעילים בשורה הקודמת — לינארי בפועל */
  const linesH = [];
  let active = [], row = -1, next = [];
  for (const r of runsH) {
    if (r.y !== row) { active = r.y === row + 1 ? next : []; next = []; row = r.y; }
    let l = active.find(q => Math.abs(q.x0 - r.x0) <= 4 && Math.abs(q.x1 - r.x1) <= 4);
    if (l) { l.y1 = r.y; l.x0 = Math.min(l.x0, r.x0); l.x1 = Math.max(l.x1, r.x1); }
    else { l = {y0: r.y, y1: r.y, x0: r.x0, x1: r.x1}; linesH.push(l); }
    next.push(l);
  }

  /* רצפים אנכיים: אורך ≥ 9pt — קצר מזה הם קווי אותיות */
  const minV = 9 * SC, runsV = [];
  for (let x = 0; x < W; x++) {
    let y = 0;
    while (y < H) {
      if (!dark[y * W + x]) { y++; continue; }
      let e = y;
      while (e + 1 < H && dark[(e + 1) * W + x]) e++;
      if (e - y + 1 >= minV) runsV.push({x: x, y0: y, y1: e});
      y = e + 1;
    }
  }
  const linesV = [];
  active = []; row = -1; next = [];
  for (const r of runsV) {
    if (r.x !== row) { active = r.x === row + 1 ? next : []; next = []; row = r.x; }
    let l = active.find(q => Math.abs(q.y0 - r.y0) <= 4 && Math.abs(q.y1 - r.y1) <= 4);
    if (l) { l.x1 = r.x; l.y0 = Math.min(l.y0, r.y0); l.y1 = Math.max(l.y1, r.y1); }
    else { l = {x0: r.x, x1: r.x, y0: r.y0, y1: r.y1}; linesV.push(l); }
    next.push(l);
  }

  /* מפיקסלים ל-user space. קו עבה מ-2.5pt הוא כתם או אות, לא קו */
  const pt = (x, y) => vp.convertToPdfPoint(x, y);
  const h = [], v = [], ticks = [];
  for (const l of linesH) {
    if (l.y1 - l.y0 + 1 > 2.5 * SC) continue;
    const a = pt(l.x0, (l.y0 + l.y1) / 2), b = pt(l.x1 + 1, (l.y0 + l.y1) / 2);
    h.push({x0: Math.min(a[0], b[0]), x1: Math.max(a[0], b[0]), y: (a[1] + b[1]) / 2});
  }
  for (const l of linesV) {
    if (l.x1 - l.x0 + 1 > 2.5 * SC) continue;
    const a = pt((l.x0 + l.x1) / 2, l.y0), b = pt((l.x0 + l.x1) / 2, l.y1 + 1);
    const q = {x: (a[0] + b[0]) / 2, y0: Math.min(a[1], b[1]), y1: Math.max(a[1], b[1])};
    v.push(q);
  }
  return {h: h, v: v, ticks: ticks};
}

/* תיבת סימון שמגיעה כתו מגופן סמלים — ולא תמיד כ-☐: בגופן עברי
   מותאם היא יכולה להיות "3", ב-Wingdings "q" או תו פרטי. לא סומכים על
   התו: מציירים את העמוד ובודקים בפיקסלים אם הגליף הוא ריבוע חלול. */
async function markGlyphBoxes(page, texts) {
  const cands = texts.filter(t => {
    const s = t.str.trim();
    if (Array.from(s).length !== 1 || t.isFill || t.rotated || BOX_CH.test(s) || t.h < 6) return false;
    if (/[.,:;'"()\-–—|\/*•·]/.test(s)) return false;
    return texts.some(o => o !== t && !o.isFill && o.str.trim().length > 1 && Math.abs(o.base - t.base) < 3 &&
                           Math.min(Math.abs(o.x - (t.x + t.w)), Math.abs(t.x - (o.x + o.w))) < 14);
  });
  if (!cands.length || window.__noGlyph) return;
  const SC = 2.5;
  const vp = page.getViewport({scale: SC, rotation: 0});
  const cv = document.createElement('canvas');
  cv.width = Math.ceil(vp.width); cv.height = Math.ceil(vp.height);
  const ctx = cv.getContext('2d', {willReadFrequently: true});
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
  await page.render({canvasContext: ctx, viewport: vp}).promise;
  for (const t of cands) {
    /* חיתוך צמוד לגובה הגליף — שלא ייכנסו זנבות של השורה שמעל */
    const a = vp.convertToViewportPoint(t.x - 1, t.base + t.h * 0.8), b = vp.convertToViewportPoint(t.x + t.w + 1, t.bot - 0.5);
    const x0 = Math.max(0, Math.floor(Math.min(a[0], b[0]))), y0 = Math.max(0, Math.floor(Math.min(a[1], b[1])));
    const w = Math.min(cv.width - x0, Math.ceil(Math.abs(b[0] - a[0]))), h = Math.min(cv.height - y0, Math.ceil(Math.abs(b[1] - a[1])));
    if (w < 6 || h < 6) continue;
    const px = ctx.getImageData(x0, y0, w, h).data;
    const ink = (x, y) => { const j = (y * w + x) * 4; return px[j] * 0.299 + px[j + 1] * 0.587 + px[j + 2] * 0.114 < 170; };
    /* רצף השורות עם דיו הארוך ביותר — תיבה צמודה מעל/מתחת לא נכנסת */
    const rowInk = [];
    for (let y = 0; y < h; y++) { let n = false; for (let x = 0; x < w && !n; x++) n = ink(x, y); rowInk.push(n); }
    let best = null, cur = null;
    for (let y = 0; y <= h; y++) {
      if (y < h && rowInk[y]) { if (!cur) cur = {a: y, b: y}; else cur.b = y; }
      else if (cur) { if (!best || cur.b - cur.a > best.b - best.a) best = cur; cur = null; }
    }
    if (!best) continue;
    let bx0 = w, bx1 = -1;
    const by0 = best.a, by1 = best.b;
    for (let y = by0; y <= by1; y++) for (let x = 0; x < w; x++) if (ink(x, y)) { if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; }
    const bw = bx1 - bx0 + 1, bh = by1 - by0 + 1;
    if (bx1 < 0 || bw < 6 || bh < 6 || bw / bh < 0.7 || bw / bh > 1.4) continue;
    /* כל אחת מארבע הצלעות מכוסה כמעט לכל אורכה, והפנים ריק */
    const band = Math.max(1, Math.round(Math.min(bw, bh) * 0.15));
    const side = (horiz, at) => {
      let n = 0;
      const len = horiz ? bw : bh;
      for (let k = 0; k < len; k++) {
        let hit = false;
        for (let d = 0; d < band && !hit; d++) {
          const x = horiz ? bx0 + k : (at ? bx1 - d : bx0 + d);
          const y = horiz ? (at ? by1 - d : by0 + d) : by0 + k;
          hit = ink(x, y);
        }
        if (hit) n++;
      }
      return n / len;
    };
    if (side(true, 0) < 0.8 || side(true, 1) < 0.8 || side(false, 0) < 0.8 || side(false, 1) < 0.8) continue;
    let inner = 0, tot = 0;
    const ix = Math.round(bw * 0.28), iy = Math.round(bh * 0.28);
    for (let y = by0 + iy; y <= by1 - iy; y++) for (let x = bx0 + ix; x <= bx1 - ix; x++) { tot++; if (ink(x, y)) inner++; }
    if (!tot || inner / tot > 0.12) continue;
    const p = vp.convertToPdfPoint(x0 + bx0, y0 + by0), q = vp.convertToPdfPoint(x0 + bx1 + 1, y0 + by1 + 1);
    t.isBox = true;
    t.inkBox = {x: Math.min(p[0], q[0]), y: Math.min(p[1], q[1]), w: Math.abs(q[0] - p[0]), h: Math.abs(q[1] - p[1])};
  }
}

function mergeH(lines, tol) {
  tol = tol || 2;
  const buckets = new Map();
  for (const l of lines) {
    const k = Math.round(l.y / tol) * tol;
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(l);
  }
  const out = [];
  for (const group of buckets.values()) {
    group.sort((a, b) => a.x0 - b.x0);
    let cur = Object.assign({}, group[0]);
    for (let i = 1; i < group.length; i++) {
      if (group[i].x0 <= cur.x1 + Math.max(tol, 3.5)) {
        cur.x1 = Math.max(cur.x1, group[i].x1);
        cur.y = (cur.y + group[i].y) / 2;
      } else { out.push(cur); cur = Object.assign({}, group[i]); }
    }
    out.push(cur);
  }
  return out;
}

function mergeV(lines, tol) {
  tol = tol || 2;
  const buckets = new Map();
  for (const l of lines) {
    const k = Math.round(l.x / tol) * tol;
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(l);
  }
  const out = [];
  for (const group of buckets.values()) {
    group.sort((a, b) => a.y0 - b.y0);
    let cur = Object.assign({}, group[0]);
    for (let i = 1; i < group.length; i++) {
      if (group[i].y0 <= cur.y1 + Math.max(tol, 3.5)) {
        cur.y1 = Math.max(cur.y1, group[i].y1);
        cur.x = (cur.x + group[i].x) / 2;
      } else { out.push(cur); cur = Object.assign({}, group[i]); }
    }
    out.push(cur);
  }
  return out;
}

/* =================================================================
   6. התא שבו יושבת התווית
   ================================================================= */
function findLocalCell(label, hLines, vLines) {
  const centerY = label.base + label.h * 0.3;

  const covering = hLines.filter(l =>
    l.x0 <= label.x + 2 && l.x1 >= label.x + label.w - 2);

  const above = covering.filter(l => l.y > centerY);
  const below = covering.filter(l => l.y < centerY);
  if (!above.length || !below.length) return null;

  const topLine = above.reduce((a, b) => (b.y < a.y ? b : a));
  const botLine = below.reduce((a, b) => (b.y > a.y ? b : a));
  const top = topLine.y, bottom = botLine.y;
  const rowHeight = top - bottom;
  if (rowHeight < 8 || rowHeight > 120) return null;

  const bounds = vLines.filter(l => {
    const ov = Math.max(0, Math.min(l.y1, top) - Math.max(l.y0, bottom));
    return ov >= rowHeight * 0.85;
  });

  const left  = bounds.filter(l => l.x <= label.x);
  const right = bounds.filter(l => l.x >= label.x + label.w);
  if (!left.length || !right.length) return null;

  const lx = left.reduce((a, b) => (b.x > a.x ? b : a)).x;
  const rx = right.reduce((a, b) => (b.x < a.x ? b : a)).x;
  if (rx - lx < 20) return null;

  return {
    cell: {x: lx, y: bottom, w: rx - lx, h: rowHeight},
    rowLeft: Math.max(topLine.x0, botLine.x0),
    rowRight: Math.min(topLine.x1, botLine.x1)
  };
}

function cellWritingBox(key, dir, label, cell, rowLeft, rowRight) {
  const pad = 5, vpad = 2, gap = 8;
  const y = cell.y + vpad, h = cell.h - vpad * 2;
  let x0, x1;
  if (dir === 'rtl') {
    x0 = (key === 'id_number' ? rowLeft : cell.x) + pad;
    x1 = label.x - gap;
  } else {
    x0 = label.x + label.w + gap;
    x1 = (key === 'id_number' ? rowRight : cell.x + cell.w) - pad;
  }
  if (x1 - x0 < 15 || h < 8) return null;
  return {x: x0, y: y, w: x1 - x0, h: h};
}

/* גבולות משבצות בתוך אזור כתיבה. מחזיר מערך x ממוין של גבולות,
   או null אם אין לפחות 4 משבצות ברוחב דומה (6–30nt). */
function digitSlots(r, cell, vLines) {
  const top = cell.y + cell.h, bottom = cell.y, rowH = cell.h;
  const xs = [];
  for (const l of vLines) {
    if (l.x < r.x - 6 || l.x > r.x + r.w + 6) continue;
    const ov = Math.max(0, Math.min(l.y1, top) - Math.max(l.y0, bottom));
    if (ov < rowH * 0.6) continue;
    if (!xs.some(x => Math.abs(x - l.x) < 2)) xs.push(l.x);
  }
  xs.sort((a, b) => a - b);
  if (xs.length < 5) return null;

  /* הרצף הארוך ביותר של משבצות ברוחב דומה */
  let best = [], run = [xs[0]];
  for (let i = 1; i < xs.length; i++) {
    const w = xs[i] - xs[i - 1], w0 = run.length > 1 ? run[1] - run[0] : w;
    if (w >= 6 && w <= 30 && Math.abs(w - w0) <= Math.max(2, w0 * 0.25)) run.push(xs[i]);
    else { if (run.length > best.length) best = run; run = [xs[i - 1], xs[i]]; }
  }
  if (run.length > best.length) best = run;
  return best.length >= 5 ? best : null;
}

/* נפילה חזרה: רצף קו תחתון או קו ציורי צמוד לתווית */
function underlineWritingBox(label, dir, segs, hLines) {
  const cands = segs.map(s => ({x0: s.x, x1: s.x + s.w, y: s.y}))
    .concat(hLines.map(l => ({x0: l.x0, x1: l.x1, y: l.y})));

  let best = null, bestGap = 1e9;
  for (const c of cands) {
    if (c.x1 - c.x0 < 15) continue;
    if (!(c.y >= label.bot - 5 && c.y <= label.top + 3)) continue;
    const gap = dir === 'rtl' ? label.x - c.x1 : c.x0 - (label.x + label.w);
    if (gap >= -4 && gap <= 18 && Math.abs(gap) < bestGap) { bestGap = Math.abs(gap); best = c; }
  }
  if (!best) return null;
  const h = Math.max(13, label.h * 1.5);
  return {x: best.x0, y: best.y - 1, w: best.x1 - best.x0, h: h};
}

/* =================================================================
   7. שורות חתימה
   ================================================================= */
function signatureRows(texts, segs, box, pageNum) {
  const labels = [];
  for (const t of texts) {
    if (t.isFill) continue;
    const m = matchSignatureLabel(t.str);
    if (m) labels.push(Object.assign({}, m, {box: t, cy: t.base}));
  }

  /* קיבוץ לפי שורה */
  const groups = [];
  for (const l of labels.sort((a, b) => a.cy - b.cy)) {
    const g = groups.find(g => Math.abs(g.cy - l.cy) <= 10);
    if (g) { g.items.push(l); g.cy = (g.cy * (g.items.length - 1) + l.cy) / g.items.length; }
    else groups.push({cy: l.cy, items: [l]});
  }

  /* כותרות תפקיד, לצורך שיוך */
  const roles = [];
  for (const t of texts) {
    const r = matchRole(t.str);
    if (r) roles.push({role: r, y: t.base});
  }

  const out = [];
  let groupNo = 0;

  for (const g of groups) {
    const by = {};
    for (const it of g.items) if (!by[it.field]) by[it.field] = it;
    if (!SIG_ORDER.every(f => by[f])) continue;        /* חייבים שלושתם */
    groupNo++;

    const tops = g.items.map(i => i.box.top), bots = g.items.map(i => i.box.bot);
    const y1 = Math.max.apply(null, tops) + 2;
    const y0 = Math.min.apply(null, bots) - 2;
    const h = Math.max(16, y1 - y0);

    /* התפקיד מהכותרת הקרובה מעל */
    let role = null, bestD = 180;
    for (const r of roles) {
      const d = r.y - y1;
      if (d >= 0 && d < bestD) { bestD = d; role = r.role; }
    }

    const dir = by.Name.direction;
    const pad = 4;
    const areas = {};
    if (dir === 'rtl') {
      /* ימין לשמאל: שם, חתימה, תאריך */
      areas.Name      = {x0: by.Signature.box.x + by.Signature.box.w + pad, x1: by.Name.box.x - pad};
      areas.Signature = {x0: by.Date.box.x + by.Date.box.w + pad,           x1: by.Signature.box.x - pad};
      areas.Date      = {x0: box.x + 25,                                    x1: by.Date.box.x - pad};
    } else {
      areas.Name      = {x0: by.Name.box.x + by.Name.box.w + pad,           x1: by.Signature.box.x - pad};
      areas.Signature = {x0: by.Signature.box.x + by.Signature.box.w + pad, x1: by.Date.box.x - pad};
      areas.Date      = {x0: by.Date.box.x + by.Date.box.w + pad,           x1: box.x + box.w - 25};
    }

    for (const field of SIG_ORDER) {
      const a = areas[field];
      let r = {x: a.x0, y: y0, w: a.x1 - a.x0, h: h};
      if (r.w < 15) continue;

      /* מצמצמים לרצף הקו שבפועל נמצא שם, כדי לא לכסות טקסט
         עזר כמו "(פרטי ומשפחה)" שיושב בין התווית לקו */
      let bestSeg = null, bestOv = 10;
      for (const s of segs) {
        if (Math.abs(s.y - g.cy) > 12) continue;
        const ov = xOverlap(r, {x: s.x, w: s.w});
        if (ov > bestOv) { bestOv = ov; bestSeg = s; }
      }
      let mode = 'gap';
      if (bestSeg) {
        const x0 = Math.max(r.x, bestSeg.x), x1 = Math.min(r.x + r.w, bestSeg.x + bestSeg.w);
        if (x1 - x0 >= 15) { r = {x: x0, y: y0, w: x1 - x0, h: h}; mode = 'underline'; }
      }

      const info = by[field];
      out.push({
        type: 'signature', page: pageNum, group: groupNo, role: role,
        field: field, key: (role ? roleKey(role) : 'unidentified') + '.' + field.toLowerCase(),
        language: info.language, direction: info.direction,
        writing_mode: mode,
        label_text: normalizeText(stripFill(info.box.str)),
        label_bbox: {x: info.box.x, y: info.box.bot, w: info.box.w, h: info.box.top - info.box.bot},
        cell_bbox: null,
        x: r.x, y: r.y, w: r.w, h: r.h,
        kind: info.kind,
        name: info.name + (role ? ' — ' + role : ''),
        conf: 0.95, src: 'cross'
      });
    }
  }
  return out;
}

const ROLE_KEYS = {'המשתתף': 'participant', 'החוקר המסביר': 'explaining_researcher', 'עד בלתי תלוי': 'independent_witness'};
const roleKey = r => ROLE_KEYS[r] || 'unidentified';

/* =================================================================
   8. זיהוי גנרי — לפי הגיאומטריה, בלי מילון
   המילון למעלה נותן שמות מדויקים לשדות מוכרים. כאן מוצאים כל
   מקום שנועד לכתיבה — קו ריק, תא ריק, שורת משבצות, תיבת סימון,
   תווית עם נקודתיים ורווח אחריה — ונותנים לו את שם הטקסט הקרוב.
   ================================================================= */
const MACHINE_NAME = /^(fill|undefined|text|field|untitled|check ?box|topmostSubform|form\d|f\d|txt|tf|cb|group|toggle|radio|button|hereby)[\s_\d.\[\]-]*|^[\d_\s.-]+$/i;

/* FamilyName2 → Family Name,  Date1_af_date → Date */
function humanize(raw) {
  return String(raw || '').replace(/_af_\w+$/i, '').replace(/\[\d+\]/g, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_.\-]+/g, ' ').replace(/\d+$/, '')
    .replace(/\s+/g, ' ').trim();
}

/* tooltip עברי ששמור בסדר חזותי: "יטרפ םש" במקום "שם פרטי".
   הסימן: מילים שמתחילות באות סופית. */
function reversedScore(str) {
  const s = String(str || '');
  /* אות סופית בתחילת מילה, או כ/מ/נ/פ/צ רגילה בסוף מילה — רק בטקסט הפוך */
  const rev = (s.match(/(^|[\s(])[ךםןףץ]/g) || []).length + (s.match(/[כמנפצ](?=[\s)]|$)/g) || []).length;
  const ok = (s.match(/[ךםןףץ](?=[\s)]|$)/g) || []).length + (s.match(/(^|[\s(])[כמנפצ]/g) || []).length;
  return rev - ok;
}
function fixReversed(str, force) {
  const s = String(str || '');
  if (!force && reversedScore(s) <= 0) return s;
  const swap = {'(': ')', ')': '(', '[': ']', ']': '['};
  return s.replace(/[֐-׿][֐-׿\s"'׳״.,()\-]*[֐-׿]/g,
    m => Array.from(m).reverse().map(c => swap[c] || c).join(''));
}
const BOX_CH = /[☐□❑❏▢◻]/;     /* כולל Wingdings: o, q, ¨ */
const RTL_CH = /[֐-׿؀-ۿ]/g;
const LTR_CH = /[A-Za-zÀ-ɏ]/g;

const KIND_WORDS = [
  ['date',      /תאריך|\bdate\b|\bdob\b|التاريخ|تاريخ|fecha|datum|ቀን/i],
  ['signature', /(^|[\s"'(*])חתימ|signature|\bsigned\b|sign here|توقيع|التوقيع|firma|ፊርማ/i],
  ['email',     /דואר אלקטרוני|דוא["״]?ל|e-?mail|البريد/i],
  ['phone',     /טלפון|נייד|פקס|phone|mobile|\btel\b|\bfax\b|هاتف|جوال|teléfono/i],
  ['id',        /ת\.?["״]?ז|תעודת זהות|מספר זהות|מס['׳]? זהות|\bid\b|identity|passport|דרכון|رقم الهوية/i]
];

/* סוג השדה לפי המילה שמופיעה ראשונה בתווית:
   "תאריך החתימה" הוא תאריך, "Signature with date" היא חתימה */
function classify(label) {
  const s = normalizeText(label);
  let best = null, at = 1e9;
  for (const [kind, re] of KIND_WORDS) {
    const m = re.exec(s);
    if (m && m.index < at) { at = m.index; best = kind; }
  }
  return best || 'text';
}

function pageDirection(texts) {
  let r = 0, l = 0;
  for (const t of texts) {
    r += (t.str.match(RTL_CH) || []).length;
    l += (t.str.match(LTR_CH) || []).length;
  }
  return r >= l * 0.6 ? 'rtl' : 'ltr';
}

const cleanLabel = s => normalizeText(stripFill(String(s).normalize('NFKC'))).replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ')
  .replace(BOX_CH, '').replace(/^[\s:：*.\-–]+|[\s:：*.\-–]+$/g, '').slice(0, 48);

/* הקווים האנכיים של העמוד הנוכחי — גבולות תאים שתווית לא חוצה */
let CUR_V = [];
const walled = (x0, x1, lo, hi) => CUR_V.some(v => v.x > x0 + 1 && v.x < x1 - 1 &&
                                                 v.y0 <= hi - 1 && v.y1 >= lo + 1);

const isWord = t => !t.isFill && !t.rotated && !t.isBox && t.str.trim() && !(BOX_CH.test(t.str) && t.str.trim().length <= 1);
const midY = t => (t.top + t.bot) / 2;

/* הרחבת פריט טקסט לרצף המילים הצמודות לו באותה שורה,
   בכיוון שמתרחק מהשדה */
function labelRun(t0, texts, away) {
  const run = [t0];
  let edge = t0;
  for (let k = 0; k < 48; k++) {
    let next = null, best = 7;
    for (const t of texts) {
      if (run.indexOf(t) !== -1 || !isWord(t) || Math.abs(t.base - edge.base) > 2) continue;
      const gap = away === 'right' ? t.x - (edge.x + edge.w) : edge.x - (t.x + t.w);
      if (gap > -2 && gap < best &&
          !walled(Math.min(edge.x, t.x), Math.max(edge.x + edge.w, t.x + t.w), t.bot, t.top)) { best = gap; next = t; }
    }
    if (!next || /[:：]/.test(edge.str) && edge !== t0) break;
    run.push(next); edge = next;
    if (run.reduce((n, t) => n + t.str.length, 0) > 40) break;
  }
  run.sort((a, b) => b.x - a.x);
  const rtl = run.some(t => t.rtl);
  if (!rtl) run.reverse();
  /* OCR שומר לפעמים כל אות כפריט נפרד — אותיות צמודות מתחברות בלי רווח */
  let str = '';
  run.forEach((t, i) => {
    if (i) {
      const p = run[i - 1];
      const gap = rtl ? p.x - (t.x + t.w) : t.x - (p.x + p.w);
      str += gap > Math.max(1.5, t.h * 0.33) ? ' ' : '';
    }
    str += t.str;
  });
  return {text: cleanLabel(str), box: run};
}

/* התווית של אזור כתיבה: באותה שורה בצד שממנו מתחילים לקרוא,
   אחרת כיתוב מתחת לקו, אחרת כותרת מעליו */
function labelFor(r, texts, dir, opt) {
  opt = opt || {};
  const cy = r.y + r.h / 2;
  let best = null, bestD = opt.maxSide || 150;
  for (const t of texts) {
    if (!isWord(t)) continue;
    if (Math.abs(midY(t) - cy) > Math.max(6, r.h * 0.6)) continue;
    const gap = dir === 'rtl' ? t.x - (r.x + r.w) : r.x - (t.x + t.w);
    if (gap >= -3 && gap < bestD) { bestD = gap; best = t; }
  }
  if (best) return labelRun(best, texts, dir === 'rtl' ? 'right' : 'left');
  if (opt.sideOnly) return null;

  best = null; bestD = 16;
  for (const t of texts) {
    if (!isWord(t) || xOverlap(r, t) < Math.min(t.w, r.w) * 0.3) continue;
    const d = r.y - t.top;
    if (d >= -3 && d < bestD) { bestD = d; best = t; }
  }
  if (best) return labelRun(best, texts, dir === 'rtl' ? 'right' : 'left');

  best = null; bestD = opt.maxAbove || 22;
  for (const t of texts) {
    if (!isWord(t) || xOverlap(r, t) < Math.min(t.w, r.w) * 0.3) continue;
    const d = t.bot - (r.y + r.h);
    if (d >= -3 && d < bestD) { bestD = d; best = t; }
  }
  if (best) {
    /* כותרת עמודה יכולה להיות בכמה שורות: "Course" / "Passed" */
    const col = texts.filter(t => isWord(t) && xOverlap(r, t) >= Math.min(t.w, r.w) * 0.5 &&
                                  t.bot >= best.bot - 1 && t.bot <= best.bot + 30);
    col.sort((a, b) => (b.base - a.base) || (dir === 'rtl' ? b.x - a.x : a.x - b.x));
    return {text: cleanLabel(col.map(t => t.str).join(' ')), box: col};
  }
  return null;
}

function genericField(r, label, extra) {
  const name = label && label.text ? label.text : '';
  const lb = label && label.box && label.box.length ? label.box : null;
  return Object.assign({
    type: 'form', group: null, role: null,
    field: name || 'Field', key: 'generic', language: null, direction: null,
    label_text: name,
    label_bbox: lb ? {x: Math.min.apply(null, lb.map(t => t.x)), y: Math.min.apply(null, lb.map(t => t.bot)),
                      w: Math.max.apply(null, lb.map(t => t.x + t.w)) - Math.min.apply(null, lb.map(t => t.x)),
                      h: Math.max.apply(null, lb.map(t => t.top)) - Math.min.apply(null, lb.map(t => t.bot))} : null,
    cell_bbox: null,
    x: r.x, y: r.y, w: r.w, h: r.h,
    kind: classify(name), name: name || 'שדה', src: 'weak'
  }, extra);
}

/* גובה שורת כתיבה מעל קו: לפי גובה הטקסט בסביבה, בלי לעלות
   על השורה שמעליו */
function heightAbove(x0, x1, y, texts, hint) {
  let h = Math.max(10, Math.min(20, (hint || 11) * 1.35));
  for (const t of texts) {
    if (!isWord(t)) continue;
    if (Math.min(x1, t.x + t.w) - Math.max(x0, t.x) <= 2) continue;
    if (t.bot > y + 1 && t.bot < y + h) h = Math.max(7, t.bot - y - 0.5);
  }
  return h;
}

/* --- שורות משבצות: מלבנים קטנים צמודים, או "שיניים" אנכיות --- */
function findCombs(g) {
  const out = [];
  const small = g.rects.filter(r => (r.stroked || r.lum < 245) && r.w >= 5 && r.w <= 30 && r.h >= 5 && r.h <= 34);
  const rows = [];
  for (const r of small.sort((a, b) => a.y - b.y || a.x - b.x)) {
    const row = rows.find(q => Math.abs(q.y - r.y) <= 1.5 && Math.abs(q.h - r.h) <= 1.5);
    if (row) row.items.push(r); else rows.push({y: r.y, h: r.h, items: [r]});
  }
  for (const row of rows) {
    const it = row.items.sort((a, b) => a.x - b.x)
      .filter((r, i, a) => !i || Math.abs(r.x - a[i - 1].x) > 1.5);   /* כפילויות */
    let run = [it[0]];
    const runs = [];
    const flush = () => { runs.push(run); };
    for (let i = 1; i < it.length; i++) {
      const p = run[run.length - 1], r = it[i];
      if (r.x - (p.x + p.w) <= 3 && Math.abs(r.w - run[0].w) <= Math.max(2, run[0].w * 0.3)) run.push(r);
      else { flush(); run = [r]; }
    }
    flush();
    /* קבוצות קצרות (3-2-4 של מספר ביטוח לאומי אמריקאי) הן משבצות רק
       כשיש קבוצה אחות באותה שורה, ברוחב משבצת דומה ובמרחק קצר */
    const ext = q => ({x0: q[0].x, x1: q[q.length - 1].x + q[q.length - 1].w, w: q[0].w});
    for (const q of runs) {
      let ok = q.length >= 4;
      if (!ok && q.length >= 2) {
        const e = ext(q);
        ok = runs.some(o => o !== q && o.length >= 2 && Math.abs(ext(o).w - e.w) <= Math.max(2, e.w * 0.3) &&
                            Math.min(Math.abs(ext(o).x0 - e.x1), Math.abs(e.x0 - ext(o).x1)) <= e.w * 3);
      }
      if (!ok) continue;
      const xs = q.map(r => r.x).concat([q[q.length - 1].x + q[q.length - 1].w]);
      out.push({x: xs[0], y: row.y, w: xs[xs.length - 1] - xs[0], h: row.h, slots: xs, cells: q.slice()});
    }
  }

  /* שיניים: קווים אנכיים קצרים ברווחים שווים על אותו בסיס */
  /* גם דפנות של מלבנים נמוכים — קבוצות "שיניים" בתוך מסגרות (כרטיס אשראי) */
  const tk = g.ticks.concat(g.v.filter(v => v.y1 - v.y0 >= 3 && v.y1 - v.y0 <= 30))
    .sort((a, b) => a.y0 - b.y0 || a.x - b.x);
  const bases = [];
  for (const t of tk) {
    const b = bases.find(q => Math.abs(q.y0 - t.y0) <= 2);
    if (b) b.items.push(t); else bases.push({y0: t.y0, items: [t]});
  }
  for (const b of bases) {
    const xs = [];
    for (const t of b.items.sort((p, q) => p.x - q.x)) if (!xs.length || t.x - xs[xs.length - 1].x > 2) xs.push(t);
    let run = [xs[0]];
    const flush = () => {
      if (run.length >= 5) {
        const h = Math.max(10, Math.max.apply(null, run.map(t => t.y1 - t.y0)));
        const sx = run.map(t => t.x);
        out.push({x: sx[0], y: b.y0, w: sx[sx.length - 1] - sx[0], h: h, slots: sx});
      }
    };
    for (let i = 1; xs.length && i < xs.length; i++) {
      const w = xs[i].x - run[run.length - 1].x, w0 = run.length > 1 ? run[1].x - run[0].x : w;
      if (w >= 6 && w <= 30 && Math.abs(w - w0) <= Math.max(2, w0 * 0.25)) run.push(xs[i]);
      else { flush(); run = [xs[i]]; }
    }
    if (xs.length) flush();
  }

  /* שתי שורות משבצות זו על זו עם אותם גבולות = משבצת אחת גבוהה */
  out.sort((a, b) => b.y - a.y);
  for (let i = 0; i < out.length; i++) {
    for (let j = i + 1; j < out.length; j++) {
      const a = out[i], b = out[j];
      if (!a || !b || a.slots.length !== b.slots.length) continue;
      if (Math.abs(a.x - b.x) > 2 || Math.abs(a.w - b.w) > 2) continue;
      if (a.y - (b.y + b.h) > 2) continue;
      const y0 = Math.min(a.y, b.y), y1 = Math.max(a.y + a.h, b.y + b.h);
      out[i] = Object.assign({}, a, {y: y0, h: y1 - y0, cells: (a.cells || []).concat(b.cells || [])});
      out[j] = null;
    }
  }
  return out.filter(Boolean);
}

/* --- תאים בטבלה: מלבן מינימלי שסגור בקווים מארבעה צדדים --- */
function findCells(H, V0) {
  const T = 2.5, cells = [], seen = new Set();
  const Hs = H.slice().sort((a, b) => b.y - a.y);
  /* תא פתוח בקצה: שני קווים אופקיים שנגמרים באותה נקודה, עם קו אנכי
     אמיתי ביניהם — הקצה המשותף הוא דופן (W-9: "Requester's name") */
  const V = V0.slice();
  for (let i = 0; i < Hs.length; i++) {
    const a = Hs[i];
    for (const end of ['x0', 'x1']) {
      const b = Hs.slice(i + 1).find(h => a.y - h.y >= 8 && a.y - h.y <= 120 && Math.abs(h[end] - a[end]) <= 3);
      if (!b) continue;
      const x = a[end];
      if (V0.some(v => Math.abs(v.x - x) <= 3 && v.y0 <= b.y + 3 && v.y1 >= a.y - 3)) continue;
      const inner = V0.some(v => v.x > Math.max(a.x0, b.x0) + 6 && v.x < Math.min(a.x1, b.x1) - 6 &&
                                 v.y0 <= b.y + 3 && v.y1 >= a.y - 3);
      if (inner) V.push({x: x, y0: b.y, y1: a.y, synthetic: true});
    }
  }
  for (const top of Hs) {
    const vs = V.filter(v => v.x >= top.x0 - T && v.x <= top.x1 + T &&
                             v.y1 >= top.y - T && v.y0 < top.y - 5).sort((a, b) => a.x - b.x);
    for (let i = 0; i < vs.length - 1; i++) {
      const L = vs[i];
      let R = null;
      for (let j = i + 1; j < vs.length; j++) if (vs[j].x - L.x >= 6) { R = vs[j]; break; }
      if (!R) continue;
      const lo = Math.max(L.y0, R.y0);
      let B = null;
      for (const h of Hs) {
        if (h.y >= top.y - 5) continue;
        if (h.y < lo - T) break;
        if (h.x0 <= L.x + T && h.x1 >= R.x - T) { B = h; break; }
      }
      if (!B) continue;
      const c = {x: L.x, y: B.y, w: R.x - L.x, h: top.y - B.y};
      const k = [c.x, c.y, c.w, c.h].map(Math.round).join(':');
      if (!seen.has(k)) { seen.add(k); cells.push(c); }
    }
  }
  /* רק תאים "עלים" — בלי קווים שחוצים אותם מבפנים */
  return cells.filter(c => !H.some(h => h.y > c.y + T && h.y < c.y + c.h - T &&
                                        xOverlap(c, {x: h.x0, w: h.x1 - h.x0}) > c.w * 0.5) &&
                           !V.some(v => v.x > c.x + T && v.x < c.x + c.w - T &&
                                        Math.min(v.y1, c.y + c.h) - Math.max(v.y0, c.y) > c.h * 0.5));
}

/* תווית שלא מסמנת מקום לכתיבה: תמונה, חותמת, "לשימוש המשרד" */
const OFFICE = /לשימוש (פנימי|המשרד|הלשכה|המוסד)|^לשימוש(\s|$)|office use|official use|for office|למילוי (ע"י|על ידי) (הפקיד|המשרד)/i;
const NOT_INPUT = /photo|תמונה|צילום|חותמת|stamp|לשימוש|office use|official use/i;

/* הבהירות של מילוי הרקע מתחת לאזור (255 = לבן / בלי מילוי) */
function shadeAt(r, rects) {
  let best = null;
  for (const q of rects) {
    if (!q.filled || q.w * q.h < r.w * r.h * 0.8) continue;
    if (inter(q, r) < r.w * r.h * 0.8) continue;
    if (!best || q.w * q.h < best.w * best.h) best = q;
  }
  return best ? best.lum : 255;
}

/* כמה מהטקסט בעמוד הוא פרוזה — שורות ארוכות ורצופות. עמוד הוראות
   (פרוזה, טבלאות מידע) מקבל רק שדות עם סימן מפורש. */
function proseRatio(texts) {
  const rows = new Map();
  for (const t of texts) {
    if (!isWord(t)) continue;
    const k = Math.round(t.base / 2);
    const r = rows.get(k) || {n: 0, x0: 1e9, x1: -1e9};
    r.n += t.str.length; r.x0 = Math.min(r.x0, t.x); r.x1 = Math.max(r.x1, t.x + t.w);
    rows.set(k, r);
  }
  let all = 0, prose = 0;
  for (const r of rows.values()) { all += r.n; if (r.n >= 70) prose += r.n; }
  return {ratio: all ? prose / all : 0, chars: all};
}

const LABEL_END = /[:：▶►➤>]\s*$/;
function onLineFields(l, words, dir) {
  const on = words.filter(t => t.base - l.y >= 0 && t.base - l.y <= 9 &&
                               t.x + t.w > l.x0 + 2 && t.x < l.x1 - 2).sort((a, b) => a.x - b.x);
  if (!on.length) return [];
  const out = [];
  const edges = [{x: l.x0, t: null}].concat(on.map(t => ({x0: t.x, x1: t.x + t.w, t: t})));
  for (let i = 0; i < on.length; i++) {
    const t = on[i];
    /* הקטע הפנוי בכיוון הקריאה שאחרי התווית */
    const x0 = dir === 'rtl' ? (i ? on[i - 1].x + on[i - 1].w : l.x0) : t.x + t.w;
    const x1 = dir === 'rtl' ? t.x : (i + 1 < on.length ? on[i + 1].x : l.x1);
    if (x1 - x0 < 45) continue;
    const run = labelRun(t, words, dir === 'rtl' ? 'right' : 'left');
    const txt = normalizeText(t.str);
    if (!LABEL_END.test(txt) && classify(run.text) === 'text') continue;
    const r = {x: x0 + 3, y: l.y + 0.5, w: x1 - x0 - 6, h: Math.max(10, Math.min(16, t.top - l.y))};
    out.push(genericField(r, run, {writing_mode: 'underline', conf: 0.6}));
  }
  return out;
}

/* "$" או "₪" ואחריו רווח עד השוליים — שורת סכום (טופסי מס) */
function amountFields(words, texts, margin, g) {
  const out = [];
  for (const t of words) {
    const s = normalizeText(t.str);
    if (!/^[$₪€£]$|[\s.][$₪€£]$/.test(s)) continue;
    const x0 = t.x + t.w + 1;
    let x1 = margin.r;
    for (const o of words) {
      if (o === t || o.x < x0 - 1) continue;
      if (Math.min(o.top, t.top) - Math.max(o.bot, t.bot) < (t.top - t.bot) * 0.4) continue;
      x1 = Math.min(x1, o.x - 2);
    }
    for (const v of g.v) if (v.x > x0 + 2 && v.x < x1 && v.y0 <= t.top && v.y1 >= t.bot) x1 = v.x - 1;
    if (x1 - x0 < 30) continue;
    const r = {x: x0, y: t.bot - 1, w: x1 - x0, h: t.top - t.bot + 3};
    if (!isEmpty(r, texts, 0.05)) continue;
    out.push(genericField(r, labelRun(t, words, 'left'), {writing_mode: 'gap', conf: 0.6}));
  }
  return out;
}

/* תווית בתוך מלבן צבוע (אפור/צבעוני) ומיד אחריה רווח לבן — המקום לכתוב.
   עיצוב נפוץ בטפסים מודרניים: "Forenames *" בפס אפור, ושדה לבן לידו. */
function shadedLabelFields(words, texts, g, margin, dir) {
  const out = [];
  const shaded = g.rects.filter(q => q.filled && q.lum < 245 && q.lum > 120 && q.h >= 10 && q.h <= 45 && q.w >= 20);
  const innerOf = q => words.filter(t => t.x >= q.x - 1 && t.x + t.w <= q.x + q.w + 1 && midY(t) > q.y && midY(t) < q.y + q.h);
  const labeled = shaded.filter(q => innerOf(q).length);
  for (const q of shaded) {
    const inner = innerOf(q);
    if (!inner.length) continue;
    /* זה דפוס עיצובי של טופס רק כשהוא חוזר: עוד שתי תוויות צבועות
       מיושרות לאותו קצה. פס צבוע בודד הוא לוגו או כותרת */
    const aligned = labeled.filter(o => o !== q && (Math.abs(o.x - q.x) < 3 || Math.abs(o.x + o.w - q.x - q.w) < 3 ||
                                                    (Math.abs(o.y - q.y) < 3 && Math.abs(o.h - q.h) < 3))).length;
    if (aligned < 2) continue;
    const txt = inner.map(t => t.str).join(' ');
    if (txt.length > 70 || inner.some(t => t.h > q.h)) continue;
    /* הצד שאחרי התווית בכיוון הקריאה */
    const x0 = dir === 'rtl' ? null : q.x + q.w + 2;
    const x1 = dir === 'rtl' ? q.x - 2 : null;
    let lo = dir === 'rtl' ? margin.l : x0, hi = dir === 'rtl' ? x1 : margin.r;
    const band = {lo: q.y + 1, hi: q.y + q.h - 1};
    const blocks = (o) => Math.min(o.y + o.h, band.hi) - Math.max(o.y, band.lo) > (band.hi - band.lo) * 0.4;
    for (const o of shaded) {
      if (o === q || !blocks(o)) continue;
      if (dir !== 'rtl' && o.x >= q.x + q.w - 1) hi = Math.min(hi, o.x - 2);
      if (dir === 'rtl' && o.x + o.w <= q.x + 1) lo = Math.max(lo, o.x + o.w + 2);
    }
    for (const t of words) {
      if (!blocks({y: t.bot, h: t.top - t.bot})) continue;
      if (dir !== 'rtl' && t.x >= q.x + q.w - 1) hi = Math.min(hi, t.x - 2);
      if (dir === 'rtl' && t.x + t.w <= q.x + 1) lo = Math.max(lo, t.x + t.w + 2);
    }
    const w = hi - lo;
    if (w < 12) continue;
    const r = {x: lo + 1, y: q.y + 1, w: w - 2, h: q.h - 2};
    if (!isEmpty(r, texts, 0.05)) continue;
    const lab = {text: cleanLabel(inner.sort((a, b) => dir === 'rtl' ? b.x - a.x : a.x - b.x).map(t => t.str).join(' ')), box: inner};
    const f = genericField(r, lab, {writing_mode: 'cell', conf: 0.6});
    if (w < 34) { f.kind = 'checkbox'; f.name = '☐ ' + lab.text; }
    out.push(f);
  }
  return out;
}

function genericDetect(texts, segs, g, box, pageNum) {
  const dir = pageDirection(texts);
  const words = texts.filter(isWord);
  const out = [];
  const hs = words.map(t => t.h).sort((a, b) => a - b);
  const medianH = hs.length ? hs[hs.length >> 1] : 11;
  const margin = words.length ? {
    l: Math.min.apply(null, words.map(t => t.x)),
    r: Math.max.apply(null, words.map(t => t.x + t.w))
  } : {l: box.x + 36, r: box.x + box.w - 36};

  /* 1. משבצות */
  const combs = findCombs(g);
  if (window.__DETDBG && window.__DETDBG[pageNum]) window.__DETDBG[pageNum].cells = findCells(g.h, g.v);
  const inComb = new Set();
  for (const c of combs) {
    (c.cells || []).forEach(r => inComb.add(r));
    const r = {x: c.x, y: c.y, w: c.w, h: c.h};
    const lab = labelFor(r, texts, dir);
    const f = genericField(r, lab, {writing_mode: 'comb', slots: c.slots, conf: 0.8, src: 'cross'});
    /* במשבצות לא כותבים כתובת מייל — התווית נלקחה מהשכן */
    if (f.kind === 'email') f.kind = 'text';
    if (f.kind === 'text' && c.slots.length >= 9 && c.slots.length <= 11) f.kind = 'id';
    out.push(f);
  }

  /* 2. תאים בטבלה */
  const cells = findCells(g.h, g.v);
  const emptyCell = c => !words.some(t => {
    const mx = t.x + t.w / 2, my = midY(t);
    return mx > c.x && mx < c.x + c.w && my > c.y && my < c.y + c.h;
  });
  /* כותרת העמודה: עולים בתאים שמעל באותה עמודה עד התא הראשון שיש בו טקסט */
  const columnHeader = c => {
    let cur = c;
    for (let k = 0; k < 40; k++) {
      const up = cells.find(d => Math.abs(d.y - (cur.y + cur.h)) <= 3 &&
                                 xOverlap(cur, d) >= Math.max(cur.w, d.w) * 0.8);
      if (!up) return null;
      const inner = words.filter(t => {
        const mx = t.x + t.w / 2, my = midY(t);
        return mx > up.x && mx < up.x + up.w && my > up.y && my < up.y + up.h;
      });
      if (inner.length) {
        inner.sort((a, b) => (b.base - a.base) || (dir === 'rtl' ? b.x - a.x : a.x - b.x));
        const txt = cleanLabel(inner.map(t => t.str).join(' '));
        return txt.length <= 60 ? {text: txt, box: inner} : null;
      }
      cur = up;
    }
    return null;
  };
  /* טבלת מידע (תאים מלאים בטקסט ארוך) ולא טופס: שם רווח בתא הוא
     סתם רווח, אלא אם התווית נגמרת בנקודתיים */
  const cellText = c => words.filter(t => {
    const mx = t.x + t.w / 2, my = midY(t);
    return mx > c.x && mx < c.x + c.w && my > c.y && my < c.y + c.h;
  }).map(t => t.str).join(' ');
  const filled = cells.map(cellText).filter(Boolean);
  const infoTable = filled.length >= 4 && filled.filter(t => t.length > 60).length > filled.length * 0.3;

  for (const c of cells) {
    if (c.w < 26 && c.h < 26) continue;                 /* משבצת/תיבת סימון — לא כאן */
    if (c.h < 8 || c.h > 400 || c.w > box.w * 0.95) continue;
    const inner = words.filter(t => {
      const mx = t.x + t.w / 2, my = midY(t);
      return mx > c.x && mx < c.x + c.w && my > c.y && my < c.y + c.h;
    });
    const txt = inner.map(t => t.str).join(' ');
    const shade = shadeAt(c, g.rects);
    if (shade < 200) continue;                           /* רצועת כותרת צבועה */
    if (!inner.length) {
      const row = cells.filter(d => Math.abs(d.y - c.y) <= 3 && Math.abs(d.h - c.h) <= 3);
      if (row.length >= 3 && row.filter(d => !emptyCell(d)).length > row.length / 2) continue;
      const r = {x: c.x + 2, y: c.y + 1.5, w: c.w - 4, h: c.h - 3};
      if (!isEmpty(r, texts, 0.05)) continue;
      let lab = labelFor(r, texts, dir, {sideOnly: true, maxSide: 60});
      if (!lab) lab = columnHeader(c);
      if (!lab) lab = labelFor(r, texts, dir, {maxSide: 60, maxAbove: 16});
      if (c.h > 170 && !lab) continue;                    /* מסגרת גדולה בלי כותרת */
      out.push(genericField(r, lab, {writing_mode: 'cell', cell_bbox: c, conf: 0.72, src: 'cross', multi: c.h > 40}));
      continue;
    }
    if (txt.length > 60 || NOT_INPUT.test(txt)) continue;  /* פסקה, או לא לכתיבה */
    if (shade < 240) continue;                           /* כותרת על רקע אפור */
    /* כותרת של עמודה בטבלה: מתחתיה תאים ריקים — הם השדות */
    const header = cells.some(d => d !== c && Math.abs((d.y + d.h) - c.y) <= 3 &&
                                   xOverlap(c, d) > Math.min(c.w, d.w) * 0.8 && emptyCell(d));
    if (header) continue;
    const tb = {
      x: Math.min.apply(null, inner.map(t => t.x)), x1: Math.max.apply(null, inner.map(t => t.x + t.w)),
      bot: Math.min.apply(null, inner.map(t => t.bot)), top: Math.max.apply(null, inner.map(t => t.top))
    };
    const below = {x: c.x + 3, y: c.y + 2, w: c.w - 6, h: tb.bot - 2 - (c.y + 2)};
    /* תווית שנועדה לכתיבה מתחתיה צמודה לראש התא. טקסט שממורכז
       בגובה התא הוא תוכן של טבלת מידע, לא תווית. */
    const topAligned = (c.y + c.h) - tb.top <= Math.max(6, (tb.top - tb.bot) * 0.9);
    if (below.h < Math.max(8, c.h * 0.3) || !topAligned) below.h = 0;
    /* שורת כותרות של טבלה: רוב התאים בשורה מלאים בטקסט עד הסוף (כותרות
       בשתי שורות). אז גם הרווח מתחת לכותרת קצרה הוא לא מקום לכתוב */
    if (below.h) {
      const rowCells = cells.filter(d => d !== c && Math.abs(d.y - c.y) <= 3 && Math.abs(d.h - c.h) <= 3);
      const tight = rowCells.filter(d => {
        const ws = words.filter(t => { const mx = t.x + t.w / 2, my = midY(t); return mx > d.x && mx < d.x + d.w && my > d.y && my < d.y + d.h; });
        return ws.length && Math.min.apply(null, ws.map(t => t.bot)) - d.y < Math.max(10, d.h * 0.3);
      }).length;
      if (rowCells.length >= 2 && tight >= Math.max(2, rowCells.length * 0.5)) below.h = 0;
    }
    /* כתיבה לצד התווית — רק כשהתווית נגמרת בנקודתיים ("שם פרטי:") */
    const colon = /[:：]\s*$|^\s*[:：]/.test(normalizeText(txt));
    if (infoTable && !colon) continue;
    const side = dir === 'rtl'
      ? {x: c.x + 4, y: c.y + 2, w: tb.x - 6 - (c.x + 4), h: c.h - 4}
      : {x: tb.x1 + 6, y: c.y + 2, w: c.x + c.w - 4 - (tb.x1 + 6), h: c.h - 4};
    /* תווית בראש התא ומקום מתחתיה — כותבים מתחת, לכל רוחב התא.
       לצד התווית כותבים רק כשאין מקום מתחת */
    const okBelow = below.h >= 8 && below.w >= 20 && isEmpty(below, texts, 0.05);
    const cands = okBelow ? [below] : [side].filter(r => r.w >= 30 && r.h >= 9 && isEmpty(r, texts, 0.05));
    if (!cands.length) continue;
    const r = cands[0];
    const lab = {text: cleanLabel(txt), box: inner};
    out.push(genericField(r, lab, {writing_mode: 'cell', cell_bbox: c, conf: 0.7, src: 'cross', multi: r.h > 40}));
  }

  /* 2ב. רצועות: שני קווים אופקיים ארוכים בלי קווים אנכיים ביניהם,
     תוויות קטנות בראש הרצועה ומקום ריק מתחתן ("Name (first, middle, last)").
     כל תווית פותחת עמודה שנמשכת עד התווית הבאה. */
  const contentW = margin.r - margin.l;
  const longH = g.h.filter(l => l.x1 - l.x0 > contentW * 0.45).sort((a, b) => b.y - a.y);
  const bandTops = [];
  for (let i = 0; i < longH.length - 1; i++) {
    const top = longH[i];
    const bot = longH.slice(i + 1).find(l => xOverlap({x: l.x0, w: l.x1 - l.x0}, {x: top.x0, w: top.x1 - top.x0}) >
                                              Math.min(l.x1 - l.x0, top.x1 - top.x0) * 0.8);
    if (!bot) continue;
    const gap = top.y - bot.y;
    if (gap < 14 || gap > 70) continue;
    const bx0 = Math.max(top.x0, bot.x0), bx1 = Math.min(top.x1, bot.x1);
    if (g.v.some(v => v.x > bx0 + 3 && v.x < bx1 - 3 && Math.min(v.y1, top.y) - Math.max(v.y0, bot.y) > gap * 0.8)) continue;
    const inBand = words.filter(t => {
      const mx = t.x + t.w / 2, my = midY(t);
      return mx > bx0 && mx < bx1 && my > bot.y && my < top.y;
    });
    if (!inBand.length || inBand.some(t => midY(t) < bot.y + gap * 0.45)) continue;   /* כבר מולא / לא תוויות */
    /* קיבוץ התוויות לעמודות לפי רווח אופקי */
    const lab = inBand.slice().sort((a, b) => a.x - b.x);
    const clusters = [];
    for (const t of lab) {
      const c = clusters[clusters.length - 1];
      if (c && t.x - c.x1 < 12) { c.items.push(t); c.x1 = Math.max(c.x1, t.x + t.w); c.bot = Math.min(c.bot, t.bot); }
      else clusters.push({x0: t.x, x1: t.x + t.w, bot: t.bot, items: [t]});
    }
    if (dir === 'rtl') clusters.reverse();
    bandTops.push(top);
    /* תווית ארוכה (משפט: "Name of entity/individual. An entry is required...")
       — כל הרצועה מתחת לה היא שדה אחד */
    const lineCount = new Set(inBand.map(t => Math.round(t.base / 3))).size;
    const longLab = clusters.some(c => c.items.map(t => t.str).join(' ').length > 45);
    if (longLab) {
      if (lineCount > 2) continue;
      const lowest = Math.min(...inBand.map(t => t.bot));
      const r = {x: bx0 + 2, y: bot.y + 1, w: bx1 - bx0 - 4, h: lowest - 1.5 - (bot.y + 1)};
      if (r.h < 9 || r.w < 40 || !isEmpty(r, texts, 0.05)) continue;
      const first = inBand.slice().sort((a, b) => (b.base - a.base) || (dir === 'rtl' ? b.x - a.x : a.x - b.x))[0];
      out.push(genericField(r, labelRun(first, texts, dir === 'rtl' ? 'left' : 'right'), {writing_mode: 'band', conf: 0.66}));
      continue;
    }
    clusters.forEach((c, k) => {
      const nx = clusters[k + 1];
      const x0 = dir === 'rtl' ? (nx ? nx.x1 + 3 : bx0 + 2) : c.x0;
      const x1 = dir === 'rtl' ? c.x1 : (nx ? nx.x0 - 3 : bx1 - 2);
      const r = {x: x0, y: bot.y + 1, w: x1 - x0, h: Math.min(...clusters.map(q => q.bot)) - 1.5 - (bot.y + 1)};
      if (r.w < 20 || r.h < 8 || !isEmpty(r, texts, 0.05)) return;
      const txt = c.items.slice().sort((a, b) => dir === 'rtl' ? b.x - a.x : a.x - b.x).map(t => t.str).join(' ');
      if (txt.length > 45 || txt.split(/\s+/).length > 7) return;          /* משפט, לא תווית */
      out.push(genericField(r, {text: cleanLabel(txt), box: c.items}, {writing_mode: 'band', conf: 0.66}));
    });
  }

  /* 3. קווי כתיבה — רצפי "____" וקווים מצוירים */
  const lines = segs.map(s => ({x0: s.x, x1: s.x + s.w, y: s.y - 2, hint: s.h, fill: true}))
    .concat(g.ul.map(l => ({x0: l.x0, x1: l.x1, y: l.y, fill: false})));
  /* שורות תשובה: כמה קווים ארוכים מקבילים זה מתחת לזה, מתחת לשאלה */
  const stacked = new Map();
  const longs = lines.filter(l => !l.fill && l.x1 - l.x0 > contentW * 0.5).sort((a, b) => b.y - a.y);
  for (let i = 0; i < longs.length; i++) {
    if (stacked.has(longs[i])) continue;
    const grp = [longs[i]];
    for (let j = i + 1; j < longs.length; j++) {
      const p = grp[grp.length - 1], q = longs[j];
      const dy = p.y - q.y;
      if (dy < 12) continue;
      if (dy > 40) break;
      if (Math.abs(p.x0 - q.x0) < 12 && Math.abs(p.x1 - q.x1) < 12) grp.push(q);
    }
    if (grp.length < 2) continue;
    const first = grp[0];
    const lab = labelFor({x: first.x0, y: first.y, w: first.x1 - first.x0, h: 14}, texts, dir, {maxAbove: 30});
    grp.forEach((l, k) => stacked.set(l, {lab: lab, k: k}));
  }
  for (const l of lines) {
    /* הקו העליון של רצועה — כותבים מתחתיו, לא מעליו */
    if (!l.fill && bandTops.some(t => Math.abs(t.y - l.y) < 2 && xOverlap({x: t.x0, w: t.x1 - t.x0}, {x: l.x0, w: l.x1 - l.x0}) > (l.x1 - l.x0) * 0.8)) continue;
    const st = stacked.get(l);
    if (st) {
      const h = heightAbove(l.x0, l.x1, l.y, texts, 11);
      const r = {x: l.x0, y: l.y, w: l.x1 - l.x0, h: h};
      if (h < 9 || !isEmpty(r, texts, 0.12)) continue;     /* אין מקום לכתוב — קו של טבלה */
      /* קו שנוגע בקווים אנכיים בקצוות שלו — שורה של טבלה (התאים כבר טופלו) */
      const touchV = x => g.v.some(v => Math.abs(v.x - x) <= 2.5 && v.y0 <= l.y + 2.5 && v.y1 >= l.y - 2.5);
      if (touchV(l.x0) && touchV(l.x1) && !isEmpty(r, texts, 0.005)) continue;
      const base = st.lab && st.lab.text ? st.lab.text : 'שורת תשובה';
      out.push(genericField(r, {text: base + (st.k ? ' · ' + (st.k + 1) : ''), box: st.lab ? st.lab.box : []},
                            {writing_mode: 'underline', conf: 0.64}));
      continue;
    }
    const w = l.x1 - l.x0;
    if (w < (l.fill ? 12 : 25)) continue;
    if (!l.fill) {
      /* מסגרת: קווים אנכיים בשני הקצוות */
      const touch = x => g.v.some(v => Math.abs(v.x - x) <= 2.5 && v.y0 <= l.y + 2.5 && v.y1 >= l.y - 2.5);
      if (touch(l.x0) || touch(l.x1)) continue;
      /* קו קישוט מתחת לכותרת */
      const deco = words.some(t => t.base - l.y >= -1 && t.base - l.y <= 5 &&
                                   (xOverlap({x: l.x0, w: w}, t) > Math.min(w, t.w) * 0.6 ||
                                    xOverlap({x: l.x0, w: w}, t) > w * 0.3));
      if (deco) continue;
    }
    const hint = l.hint || 11;
    const h = heightAbove(l.x0, l.x1, l.y, texts, hint);
    /* קו שיש עליו טקסט צמוד: מפריד בין פסקאות, או שורה שהתוויות שלה
       יושבות עליה ("Signature ▶ ______ Date ▶ ____"). במקרה השני — שדה
       בכל קטע פנוי שבא אחרי תווית מפורשת */
    if (!l.fill && h < 9) {
      for (const f of onLineFields(l, words, dir)) out.push(f);
      continue;
    }
    const r = {x: l.x0, y: l.y, w: w, h: h};
    if (!isEmpty(r, texts, 0.12)) continue;
    const lab = labelFor(r, texts, dir);
    if (!l.fill && !lab && w > (box.w * 0.5)) continue;   /* קו מפריד */
    /* קו צמוד בין שתי שורות טקסט (קישוט בלוגו, מפריד) — אין מעליו מקום
       לכתיבה, והתווית היחידה מתחתיו */
    if (!l.fill && h < 13 && lab && lab.box && lab.box.length && lab.box[0].base < l.y) continue;
    if (!l.fill && w > box.w * 0.85) continue;           /* קו לרוחב כל הדף ("גזור כאן") */
    out.push(genericField(r, lab, {writing_mode: 'underline', conf: l.fill ? 0.7 : 0.62}));
  }

  /* 4. תווית עם נקודתיים ואחריה רווח ריק */
  for (const t of words) {
    const s = normalizeText(t.str);
    if (!/^[:：]|[:：]$/.test(s)) continue;
    const plain = s.replace(/[:：]/g, '').trim();
    const nWords = plain.split(/\s+/).length;
    const wide = t.w > (margin.r - margin.l) * 0.45 || nWords > 7;
    if (nWords > 12) continue;
    const toLeft = t.rtl || (dir === 'rtl' && !plain);
    const band = {lo: t.bot, hi: t.top};
    /* המכשול הקרוב בצד הכתיבה: טקסט, קו אנכי, או השוליים */
    let edge = toLeft ? margin.l : margin.r;
    for (const o of words) {
      if (o === t || Math.min(o.top, band.hi) - Math.max(o.bot, band.lo) < (band.hi - band.lo) * 0.4) continue;
      if (toLeft && o.x + o.w <= t.x + 1) edge = Math.max(edge, o.x + o.w);
      if (!toLeft && o.x >= t.x + t.w - 1) edge = Math.min(edge, o.x);
    }
    for (const v of g.v) {
      if (v.y0 > band.hi || v.y1 < band.lo) continue;
      if (toLeft && v.x < t.x - 1) edge = Math.max(edge, v.x);
      if (!toLeft && v.x > t.x + t.w + 1) edge = Math.min(edge, v.x);
    }
    const x0 = toLeft ? edge + 3 : t.x + t.w + 4;
    const x1 = toLeft ? t.x - 4 : edge - 3;
    const lab = plain ? labelRun(t, texts, toLeft ? 'right' : 'left') : labelFor({x: x0, y: t.bot, w: 1, h: t.top - t.bot}, texts, toLeft ? 'rtl' : 'ltr');
    const reachesMargin = toLeft ? edge <= margin.l + 1 : edge >= margin.r - 1;

    /* כותרת ולא תווית: קו תחתון מתחתיה, או גופן גדול מהרגיל */
    /* העוגן: הפריט עצמו, ואם הוא רק ":" — המילה שלידו */
    const anchor = plain ? t : ((lab && lab.box && lab.box[0]) || t);
    const underlined = g.ul.some(l => Math.abs(l.y - anchor.base) <= 3.5 &&
                                      xOverlap({x: l.x0, w: l.x1 - l.x0}, anchor) > anchor.w * 0.5);
    if (underlined || anchor.h > medianH * 1.3) continue;
    /* סוף של פסקה: השורה שמעל ממשיכה מעל המקום של השדה */
    const fw = Math.max(1, x1 - x0);
    const paragraph = words.filter(o => o !== t && o.bot > t.top - 3 && o.bot < t.top + t.h * 1.2)
                           .reduce((n, o) => n + xOverlap({x: x0, w: fw}, o), 0) > fw * 0.5;
    if (paragraph) continue;

    /* שורה ריקה וגדולה מתחת — שדה של כמה שורות */
    let nextTop = box.y + 40;
    for (const o of words) if (o.top < t.bot - 2 && o.top > nextTop) nextTop = o.top;
    const gapBelow = t.bot - nextTop;
    if (reachesMargin && gapBelow >= 45 && (nWords >= 3 || wide) && nextTop > box.y + 41) {
      const r = {x: margin.l, y: nextTop + 6, w: margin.r - margin.l, h: Math.min(140, gapBelow - 10)};
      if (isEmpty(r, texts, 0.05)) {
        out.push(genericField(r, lab, {writing_mode: 'gap', conf: 0.5, multi: true}));
        continue;
      }
    }
    if (wide || x1 - x0 < 40) continue;
    /* משפט פתיחה לרשימה ("I certify that:") — השורה הבאה צמודה מתחת */
    if (nWords >= 5 && words.some(o => o !== t && o.top < t.bot + 2 && o.top > t.bot - t.h * 1.2 &&
                                       xOverlap(o, {x: x0, w: Math.max(1, x1 - x0)}) > 0)) continue;
    /* כותרת של טבלה שמתחילה מיד מתחת */
    /* "פירוט הבקשה:" ומתחת שורות כתיבה — כותבים בשורות, לא לצד התווית */
    if (lines.some(l => l.y < t.bot && l.y > t.bot - 25 &&
                        xOverlap({x: l.x0, w: l.x1 - l.x0}, {x: x0, w: Math.max(1, x1 - x0)}) > (x1 - x0) * 0.5)) continue;
    if (cells.some(c => c.y + c.h <= t.bot + 3 && c.y + c.h >= t.bot - 25 && xOverlap(c, t) > 0)) continue;
    const r = {x: x0, y: t.bot - 1, w: x1 - x0, h: (t.top - t.bot) + 3};
    if (!isEmpty(r, texts, 0.08)) continue;
    out.push(genericField(r, lab, {writing_mode: 'gap', conf: 0.52}));
  }

  for (const f of amountFields(words, texts, margin, g)) out.push(f);
  for (const f of shadedLabelFields(words, texts, g, margin, dir)) out.push(f);

  /* 4ב. "חתימה" / "Signature" לבד בשורה — חותמים במקום הריק שמעליה */
  for (const t of words) {
    const s = cleanLabel(t.str);
    if (!s || s.split(/\s+/).length > 5 || classify(s) !== 'signature') continue;
    const alone = !words.some(o => o !== t && Math.abs(o.base - t.base) < 3 &&
                                   (o.x > t.x + t.w ? o.x - (t.x + t.w) : t.x - (o.x + o.w)) < 50);
    if (!alone) continue;
    /* "חתימה ______" — הקו שלידה הוא המקום, לא הרווח שמעל */
    const lineBeside = lines.some(l => Math.abs(l.y - t.base) < 5 &&
                                       Math.min(Math.abs(l.x0 - (t.x + t.w)), Math.abs(t.x - l.x1)) < 30);
    if (lineBeside) continue;
    const r = {x: t.x - 25, y: t.top + 2, w: t.w + 50, h: 22};
    if (!isEmpty(r, texts, 0.02)) continue;
    out.push(genericField(r, {text: s, box: [t]}, {writing_mode: 'gap', conf: 0.48}));
  }

  /* 5. תיבות סימון — ריבועים מצוירים ותווים כמו ☐ */
  const boxes = [];
  for (const r0 of g.rects) {
    if (inComb.has(r0) || !(r0.stroked || r0.lum < 245)) continue;
    const sq = r0.w >= 6 && r0.w <= 26 && r0.h >= 6 && r0.h <= 26 && r0.w / r0.h > 0.7 && r0.w / r0.h < 1.4;
    if (!sq) continue;
    if (combs.some(c => overlapRatio(c, r0) > 0.5)) continue;
    const r = {x: r0.x + 1, y: r0.y + 1, w: r0.w - 2, h: r0.h - 2};
    if (r.w >= 4 && isEmpty(r, texts, 0.08)) boxes.push(r);
  }
  for (const t of texts) {
    if (t.isBox) { boxes.push(t.inkBox); continue; }
    const s = t.str.trim();
    if (!s || !BOX_CH.test(s)) continue;
    const h = Math.max(6, Math.min(14, t.h * 0.85));
    const chars = Array.from(s);
    const at = chars.findIndex(c => BOX_CH.test(c));
    let x;
    if (chars.length === 1) x = t.x + (t.w - h) / 2;
    else if (at === 0) x = t.rtl ? t.x + t.w - h : t.x;
    else if (at === chars.length - 1) x = t.rtl ? t.x : t.x + t.w - h;
    else continue;
    boxes.push({x: x, y: t.base - h * 0.1, w: h, h: h});
  }
  for (const r of boxes) {
    const lab = labelFor(r, texts, dir === 'rtl' ? 'ltr' : 'rtl', {sideOnly: true, maxSide: 30});
    const f = genericField(r, lab, {writing_mode: 'box', conf: 0.6});
    f.kind = 'checkbox';
    f.name = lab && lab.text ? '☐ ' + lab.text : 'סימון';
    out.push(f);
  }

  /* אזור שיושב על תמונה (לוגו, חותמת) אינו שדה */
  const onImage = f => g.images.some(im => inter(im, f) > f.w * f.h * 0.3);
  /* אזור בלי שום תווית בסביבה הוא כמעט תמיד רווח עיצובי, לא שדה —
     חוץ ממשבצות, קו "____" מפורש ותיבת סימון */
  const keep = f => f.label_text || f.writing_mode === 'comb' || f.kind === 'checkbox' ||
                    (f.writing_mode === 'underline' && f.conf >= 0.7);
  /* מסגרת "לשימוש פנימי / לשימוש המשרד" — כל מה שבתוכה לא למילוי */
  const office = [];
  for (const t of words) {
    if (!/לשימוש|office|official|למילוי/i.test(t.str)) continue;      /* סינון זול לפני labelRun */
    if (!OFFICE.test(normalizeText(t.str) +' ' + labelRun(t, words, 'left').text + ' ' + labelRun(t, words, 'right').text)) continue;
    let best = null;
    for (const q of g.rects) {
      if (!q.stroked && !(q.filled && q.lum < 245)) continue;
      if (q.w * q.h > box.w * box.h * 0.3 || q.w * q.h < t.w * t.h * 3) continue;
      if (t.x < q.x - 1 || t.x + t.w > q.x + q.w + 1 || t.bot < q.y - 1 || t.top > q.y + q.h + 1) continue;
      if (!best || q.w * q.h > best.w * best.h) best = q;
    }
    if (best) office.push(best);
    /* התווית בתא משלה, והשדות בתאים צמודים של אותה טבלה קטנה:
       מתחילים מהתא של התווית ומתפשטים לתאים שנוגעים בו */
    const home = cells.filter(c => t.x >= c.x - 1 && t.x + t.w <= c.x + c.w + 1 && midY(t) > c.y && midY(t) < c.y + c.h)
                      .sort((a, b) => a.w * a.h - b.w * b.h)[0];
    if (home) {
      const touch = (a, b) => a.x <= b.x + b.w + 3 && b.x <= a.x + a.w + 3 && a.y <= b.y + b.h + 3 && b.y <= a.y + a.h + 3;
      const grp = [home];
      for (let changed = true; changed;) {
        changed = false;
        for (const c of cells) if (grp.indexOf(c) === -1 && grp.some(d => touch(c, d))) { grp.push(c); changed = true; }
      }
      /* וגם לאורך הקווים שתוחמים את התא מלמעלה ומלמטה — המסגרת כולה */
      const rims = g.h.filter(l => (Math.abs(l.y - home.y) < 3 || Math.abs(l.y - home.y - home.h) < 3) &&
                                   l.x0 <= home.x + 3 && l.x1 >= home.x + home.w - 3);
      const xs0 = grp.map(c => c.x).concat(rims.map(l => l.x0)), xs1 = grp.map(c => c.x + c.w).concat(rims.map(l => l.x1));
      const x0 = Math.min(...xs0), y0 = Math.min(...grp.map(c => c.y));
      const reg = {x: x0, y: y0, w: Math.max(...xs1) - x0, h: Math.max(...grp.map(c => c.y + c.h)) - y0};
      if (reg.w * reg.h < box.w * box.h * 0.15) office.push(reg);
    }
  }
  const inOffice = f => office.some(q => inter(q, f) > f.w * f.h * 0.6);
  /* שולי הדף (כותרת תחתונה, פס עליון) */
  const inMargin = f => f.y < box.y + 28 || f.y + f.h > box.y + box.h - 18;
  /* אזור שמכוסה באותיות/לוגו מצוירים כווקטור אינו ריק */
  const onArt = f => {
    if (f.kind === 'checkbox') return false;
    let c = 0, n = 0;
    for (const q of g.art) {
      const i = inter(q, f);
      if (!i) continue;
      c += i;
      if (q.w < 20 && q.h < 20 && i > q.w * q.h * 0.6) n++;          /* אות מצוירת */
      if (c > f.w * f.h * 0.12 || n >= 4) return true;
    }
    return false;
  };
  out.forEach(f => { f.page = pageNum; });
  return out.filter(f => !onImage(f) && keep(f) && !inOffice(f) && !inMargin(f) && !onArt(f));
}

/* =================================================================
   9. הצינור לעמוד אחד
   ================================================================= */
async function detectPage(page, pageNum) {
  const vp = page.getViewport({scale: 1, rotation: 0});
  const bb = vp.viewBox;
  const box = {x: bb[0], y: bb[1], w: bb[2] - bb[0], h: bb[3] - bb[1]};

  const res = await Promise.all([
    page.getTextContent(),
    page.getAnnotations({intent: 'display'}).catch(function () { return []; }),
    page.getOperatorList()
  ]);
  const annots = res[1];
  const g = graphics(res[2]);
  /* דף שכולו תמונה (סריקה) — הקווים נמצאים בפיקסלים */
  const big = g.images.filter(im => im.w * im.h > box.w * box.h * 0.5);
  /* סריקה = תמונה גדולה, וטקסט — אם יש — שקוף (OCR). תמונת רקע
     מתחת לטקסט אמיתי היא עיצוב, לא סריקה. */
  const scanned = big.length && (g.glyphsShown < 40 + g.glyphsHidden * 0.2 || g.h.length + g.v.length < 6);
  if (scanned) {
    const rl = await rasterLines(page);
    g.h = mergeH(g.h.concat(rl.h));
    g.v = mergeV(g.v.concat(rl.v));
    g.ul = mergeH(g.ul.concat(rl.h));
    g.ticks = g.ticks.concat(rl.ticks);
    g.scanned = true;
  }
  /* תמונה שמכסה את רוב הדף היא רקע — שדות יושבים עליה */
  g.images = g.images.filter(im => big.indexOf(im) === -1);
  CUR_V = g.v;
  const texts = refineWithGlyphs(textBoxes(res[0]), g.fills);
  await markGlyphBoxes(page, texts);
  const segs = underlineSegments(texts);
  if (window.__DETDBG) window.__DETDBG[pageNum] = {g: g, texts: texts, segs: segs, box: box, prose: proseRatio(texts)};

  const out = [];

  /* --- שדות טופס אמיתיים --- */
  /* tooltips בעברית הפוכה? מחליטים פעם אחת לכל העמוד */
  const revTips = annots.reduce((n, a) => n + reversedScore(a.alternativeText) + reversedScore(a.fieldName), 0) > 0;
  for (const a of annots) {
    if (a.subtype !== 'Widget' || a.readOnly || a.hidden) continue;
    if (a.fieldType === 'Btn' && !a.checkBox && !a.radioButton) continue;
    const rc = a.rect;
    const r = {x: Math.min(rc[0], rc[2]), y: Math.min(rc[1], rc[3]),
               w: Math.abs(rc[2] - rc[0]), h: Math.abs(rc[3] - rc[1])};
    if (r.w < 6 || r.h < 5) continue;

    let kind = (a.checkBox || a.radioButton) ? 'checkbox'
             : (a.fieldType === 'Sig' ? 'signature' : 'text');
    let name = normalizeText(a.fieldName) || 'שדה';
    let key = 'widget', lang = null, dir = null;

    /* הסוג שכתוב בקובץ לא קובע: שדה טקסט ששמו "תאריך" מקבל לוח
       שנה, ושדה ששמו "חתימה" מקבל משטח ציור. */
    if (kind !== 'checkbox') {
      const sig = matchSignatureLabel(a.fieldName) || matchSignatureLabel(a.alternativeText);
      const frm = !sig && (matchFormLabel(a.fieldName) || matchFormLabel(a.alternativeText));
      if (sig) { kind = sig.kind; name = sig.name; key = sig.field.toLowerCase(); lang = sig.language; dir = sig.direction; }
      else if (frm) { kind = frm.def.kind; name = frm.def.name; key = frm.def.key; lang = frm.language; dir = frm.direction; }
    }
    /* השם הפנימי של השדה לרוב לא מיועד לעין אנושית: fill_12,
       topmostSubform[0].f1_01[0], undefined, Group1, FamilyName2.
       עדיף ה-tooltip, אחריו הטקסט שליד השדה, ורק בסוף השם המנוקה. */
    if (key === 'widget') {
      const raw = normalizeText(a.fieldName);
      const tip = cleanLabel(fixReversed(a.alternativeText || '', revTips));
      const good = n => n && n.length >= 2 && !MACHINE_NAME.test(n) &&
                        (/[֐-׿؀-ۿ]/.test(n) || /[a-z]\s+[a-z]/i.test(n));
      const pdir = pageDirection(texts);
      /* לתיבת סימון — הטקסט שלצידה הוא שם האפשרות ("רווק", "Yes") */
      const lab = kind === 'checkbox'
        ? (labelFor(r, texts, pdir === 'rtl' ? 'ltr' : 'rtl', {sideOnly: true, maxSide: 40}) || labelFor(r, texts, pdir))
        : null;
      if (lab && lab.text) name = lab.text;
      else if (good(tip)) name = tip;
      else if (good(raw)) name = cleanLabel(fixReversed(raw, revTips));
      else {
        const near = labelFor(r, texts, pdir);
        const fall = [tip, raw].map(humanize).find(n => n && !MACHINE_NAME.test(n));
        name = (near && near.text) || fall || (kind === 'checkbox' ? 'סימון' : 'שדה');
      }
      if (kind === 'text') {
        kind = classify(name);
        if (kind === 'text') kind = classify(humanize(raw));
        if (kind === 'text' && /date/i.test(raw)) kind = 'date';
      }
    }
    if (kind === 'checkbox' && name.length < 2) name = 'סימון';
    out.push({
      type: 'form', page: pageNum, group: null, role: null,
      field: name, key: key, language: lang, direction: dir,
      writing_mode: 'acroform', label_text: normalizeText(a.fieldName),
      label_bbox: null, cell_bbox: null,
      x: r.x, y: r.y, w: r.w, h: r.h,
      kind: kind, name: name, conf: 1, src: 'acroform', multi: !!a.multiLine
    });
  }

  /* טופס עם שדות אמיתיים — היוצר כבר הגדיר איפה כותבים */
  const pdir = pageDirection(texts);
  if (out.length >= 2) return dedupe(out).map(f => Object.assign(f, {pdir: pdir}));

  /* --- שורות חתימה --- */
  for (const f of signatureRows(texts, segs, box, pageNum)) out.push(f);

  /* --- שדות טופס רגילים: תא בטבלה, ואם אין — קו --- */
  const used = [];
  for (const t of texts) {
    if (t.isFill) continue;
    const m = matchFormLabel(t.str);
    if (!m) continue;
    /* תווית אחת לכל שדה בעמוד — הקצרה ביותר היא התווית עצמה */
    const prev = used.find(u => u.key === m.def.key);
    if (prev && normalizeText(prev.box.str).length <= normalizeText(t.str).length) continue;

    const local = findLocalCell(t, g.h, g.v);
    let r = null, mode = null, cell = null;
    if (local) {
      cell = local.cell;
      r = cellWritingBox(m.def.key, m.direction, t, local.cell, local.rowLeft, local.rowRight);
      if (r) mode = 'cell';
    }
    if (!r) {
      r = underlineWritingBox(t, m.direction, segs, g.h);
      if (r) mode = 'underline';
    }
    if (!r || !isEmpty(r, texts, 0.08)) continue;

    /* משבצות ספרות (ת"ז וכדומה): קווים אנכיים בתוך אזור הכתיבה
       שחוצים את כל גובה השורה. כל ספרה תיכתב במשבצת שלה. */
    let slots = null;
    if (mode === 'cell') slots = digitSlots(r, cell, g.v);
    if (slots) { r = {x: slots[0], y: r.y, w: slots[slots.length - 1] - slots[0], h: r.h}; }

    if (prev) out.splice(out.indexOf(prev.field), 1);
    const field = {
      type: 'form', page: pageNum, group: null, role: null,
      field: m.def.field, key: m.def.key, language: m.language, direction: m.direction,
      writing_mode: mode,
      label_text: normalizeText(stripFill(t.str)),
      label_bbox: {x: t.x, y: t.bot, w: t.w, h: t.top - t.bot},
      cell_bbox: cell,
      x: r.x, y: r.y, w: r.w, h: r.h,
      kind: m.def.kind, name: m.def.name, slots: slots,
      conf: mode === 'cell' ? 0.95 : 0.85, src: 'cross'
    };
    used.push({key: m.def.key, box: t, field: field});
    out.push(field);
  }

  /* --- כל השאר: זיהוי גנרי לפי הגיאומטריה --- */
  for (const f of genericDetect(texts, segs, g, box, pageNum)) out.push(f);

  return dedupe(out).map(f => Object.assign(f, {pdir: pdir}));
}

function dedupe(C) {
  C.sort((a, b) => b.conf - a.conf);
  const out = [];
  for (const c of C) {
    if (c.kind === 'checkbox' ? (c.w < 4 || c.h < 4) : (c.w < 15 || c.h < 7)) continue;
    if (out.some(k => overlapRatio(k, c) > 0.4)) continue;
    out.push(c);
  }
  return out;
}

/* =================================================================
   9. מסנן ריהוט — כותרת שחוזרת בכל העמודים אינה שדה
   ================================================================= */
function dropRepeats(fields, numPages) {
  if (numPages < 3) return fields;
  const key = f => [Math.round(f.x/3), Math.round(f.y/3), Math.round(f.w/3), Math.round(f.h/3)].join(':');
  const seen = new Map();
  for (const f of fields) {
    const k = key(f);
    if (!seen.has(k)) seen.set(k, new Set());
    seen.get(k).add(f.page);
  }
  const limit = Math.max(3, Math.ceil(numPages * 0.5));
  return fields.filter(f => seen.get(key(f)).size < limit || f.conf >= 0.85);
}

return {
  detectPage: detectPage,
  dropRepeats: dropRepeats,
  matchFormLabel: matchFormLabel,
  matchSignatureLabel: matchSignatureLabel,
  normalizeText: normalizeText,
  HEB: HEB
};
})();
