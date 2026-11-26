// 공용 유틸: DOM 헬퍼, 대화상자, 메뉴, 텍스트 처리
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const uid = () => Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const unesc = s => String(s ?? '').replace(/&(amp|lt|gt|quot|#39);/g, (m, c) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" }[c]));

export function h(tag, props, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else if (k === 'html') e.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'data' && typeof v === 'object') Object.assign(e.dataset, v);
    else if (k in e && k !== 'list') { try { e[k] = v; } catch { e.setAttribute(k, v); } }
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    e.append(kid.nodeType ? kid : document.createTextNode(kid));
  }
  return e;
}

export function s(tag, props, ...kids) {
  const e = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2).toLowerCase(), v);
    else e.setAttribute(k === 'class' ? 'class' : k, v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    e.append(kid.nodeType ? kid : document.createTextNode(kid));
  }
  return e;
}

export function sel(options, value, onchange, props = {}) {
  const e = h('select', props, options.map(o => Array.isArray(o) ? h('option', { value: o[0] }, o[1]) : h('option', { value: o }, o)));
  e.value = value ?? '';
  if (onchange) e.addEventListener('change', () => onchange(e.value));
  return e;
}
export const inp = (value, onInput, props = {}) => h('input', { type: 'text', value: value ?? '', oninput: e => onInput && onInput(e.target.value), ...props });
export const area = (value, onInput, props = {}) => h('textarea', { value: value ?? '', oninput: e => onInput && onInput(e.target.value), ...props });
export const field = (label, control, hint) => h('label', { class: 'field' }, h('span', { class: 'lbl' }, label), control, hint ? h('small', { class: 'muted' }, hint) : null);

export const debounce = (fn, ms = 400) => {
  let t; let args;
  const d = (...a) => { args = a; clearTimeout(t); t = setTimeout(() => { t = null; fn(...args); }, ms); };
  d.flush = () => { if (t) { clearTimeout(t); t = null; fn(...args); } };
  d.cancel = () => { clearTimeout(t); t = null; };
  return d;
};

export function toast(msg, ms = 2400) {
  let box = $('#toasts');
  if (!box) { box = h('div', { id: 'toasts' }); document.body.append(box); }
  const t = h('div', { class: 'toast' }, msg);
  box.append(t);
  setTimeout(() => t.classList.add('out'), ms);
  setTimeout(() => t.remove(), ms + 400);
}

export function dialog({ title, body, buttons = [], wide = false, onClose }) {
  let closed = false;
  const close = () => {
    if (closed) return; closed = true;
    ov.remove(); document.removeEventListener('keydown', key, true); onClose && onClose();
  };
  const key = e => { if (e.key === 'Escape' && ov === [...document.querySelectorAll('.overlay')].pop()) { e.stopPropagation(); close(); } };
  const ov = h('div', { class: 'overlay', onmousedown: e => { if (e.target === ov) close(); } },
    h('div', { class: 'dlg' + (wide ? ' wide' : ''), role: 'dialog' },
      title ? h('div', { class: 'dlg-head' }, h('b', {}, title), h('button', { class: 'iconbtn', onclick: close, title: '닫기' }, '✕')) : null,
      h('div', { class: 'dlg-body' }, body),
      buttons.length ? h('div', { class: 'dlg-foot' }, buttons.map(b => h('button', { class: 'btn ' + (b.kind || ''), onclick: () => (b.onClick ? b.onClick(close) : close()) }, b.label))) : null));
  document.body.append(ov);
  document.addEventListener('keydown', key, true);
  return { close, el: ov };
}

export const confirmDlg = (msg, okLabel = '확인', danger = false) => new Promise(res => {
  dialog({
    title: '확인', body: h('p', { style: { whiteSpace: 'pre-wrap', margin: 0 } }, msg),
    buttons: [{ label: '취소', onClick: c => { res(false); c(); } }, { label: okLabel, kind: danger ? 'danger' : 'primary', onClick: c => { res(true); c(); } }],
    onClose: () => res(false),
  });
});

export const promptDlg = (label, value = '', opts = {}) => new Promise(res => {
  const ctrl = opts.multiline ? h('textarea', { rows: 5, value }) : h('input', { type: 'text', value });
  const ok = c => { res(ctrl.value.trim()); c(); };
  const d = dialog({
    title: opts.title || label, body: h('div', { class: 'stack' }, opts.title ? h('div', { class: 'muted' }, label) : null, ctrl),
    buttons: [{ label: '취소', onClick: c => { res(null); c(); } }, { label: opts.ok || '확인', kind: 'primary', onClick: ok }],
    onClose: () => res(null),
  });
  if (!opts.multiline) ctrl.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); ok(d.close); } });
  setTimeout(() => { ctrl.focus(); ctrl.select?.(); }, 30);
});

export function menu(anchor, items) {
  document.querySelectorAll('.popmenu').forEach(m => m.remove());
  const r = anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : { left: anchor.x, right: anchor.x, top: anchor.y, bottom: anchor.y };
  let off;
  const m = h('div', { class: 'popmenu' }, items.filter(Boolean).map(it => it.sep ? h('hr') : h('button', { class: it.danger ? 'danger' : '', onclick: () => { m.remove(); off(); it.onClick(); } }, it.label)));
  document.body.append(m);
  const mw = m.offsetWidth, mh = m.offsetHeight;
  m.style.left = Math.max(4, Math.min(r.left, innerWidth - mw - 4)) + 'px';
  let top = r.bottom + 4; if (top + mh > innerHeight - 4) top = Math.max(4, r.top - mh - 4);
  m.style.top = top + 'px';
  const outside = e => { if (!m.contains(e.target)) { m.remove(); off(); } };
  off = () => document.removeEventListener('mousedown', outside, true);
  setTimeout(() => document.addEventListener('mousedown', outside, true));
  return m;
}

export function download(blob, name) {
  const a = h('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
}

export function pickFiles(accept, multiple = false) {
  return new Promise(res => {
    const i = h('input', { type: 'file', accept, multiple, style: { display: 'none' } });
    i.addEventListener('change', () => { res([...i.files]); i.remove(); });
    i.addEventListener('cancel', () => { res([]); i.remove(); });
    document.body.append(i); i.click();
  });
}

export const blobToDataURL = b => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(b); });

export const two = n => String(n).padStart(2, '0');
export const fmtDate = ts => { if (!ts) return ''; const d = new Date(ts); return `${d.getFullYear()}.${two(d.getMonth() + 1)}.${two(d.getDate())}`; };
export const fmtDT = ts => { if (!ts) return ''; const d = new Date(ts); return `${fmtDate(ts)} ${two(d.getHours())}:${two(d.getMinutes())}`; };
export const ago = ts => {
  if (!ts) return '기록 없음';
  const m = Math.floor((Date.now() - ts) / 60000);
  if (m < 1) return '방금'; if (m < 60) return m + '분 전';
  const hr = Math.floor(m / 60); if (hr < 24) return hr + '시간 전';
  return Math.floor(hr / 24) + '일 전';
};

export function sanitizeHTML(html) {
  const doc = new DOMParser().parseFromString('<body>' + (html || '') + '</body>', 'text/html');
  doc.querySelectorAll('script,style,iframe,object,embed,link,meta,form,base,svg').forEach(n => n.remove());
  doc.body.querySelectorAll('*').forEach(el => {
    for (const a of [...el.attributes]) {
      const n = a.name.toLowerCase();
      if (n.startsWith('on') || ((n === 'href' || n === 'src') && /^\s*javascript:/i.test(a.value))) el.removeAttribute(a.name);
    }
  });
  return doc.body.innerHTML;
}

// HTML 원고 → 일반 텍스트 + 각주 목록
export function htmlToText(html, marks = true) {
  const doc = new DOMParser().parseFromString('<body>' + (html || '') + '</body>', 'text/html');
  const notes = [];
  const BLOCK = /^(P|DIV|H[1-6]|LI|BLOCKQUOTE|TR|UL|OL|FIGURE)$/;
  const walk = n => {
    let o = '';
    for (const c of n.childNodes) {
      if (c.nodeType === 3) o += c.nodeValue;
      else if (c.nodeType === 1) {
        if (c.tagName === 'BR') o += '\n';
        else if (c.classList.contains('fn')) { notes.push(c.getAttribute('data-note') || ''); if (marks) o += `[${notes.length}]`; }
        else if (c.tagName === 'IMG') o += '';
        else { const t = walk(c); o += BLOCK.test(c.tagName) ? (t.endsWith('\n') ? t : t + '\n') : t; }
      }
    }
    return o;
  };
  const text = walk(doc.body).replace(/ /g, ' ').replace(/​/g, '').replace(/\n{4,}/g, '\n\n\n').replace(/\s+$/, '');
  return { text, notes };
}
export const countChars = text => ({ all: text.replace(/[\r\n]/g, '').length, nospace: text.replace(/\s/g, '').length });
export const plainFromHTML = html => htmlToText(html, false).text;

export const textToHTML = text => text.replace(/\r\n?/g, '\n').split('\n').map(l => `<p>${l.trim() ? esc(l) : '<br>'}</p>`).join('');

// 간단한 툴팁
let tipEl;
export function showTip(target, html) {
  if (!tipEl) { tipEl = h('div', { class: 'tip' }); document.body.append(tipEl); }
  tipEl.innerHTML = html; tipEl.style.display = 'block';
  const r = target.getBoundingClientRect();
  const w = tipEl.offsetWidth, hh = tipEl.offsetHeight;
  let top = r.top - hh - 8; if (top < 4) top = r.bottom + 8;
  tipEl.style.left = Math.max(6, Math.min(r.left, innerWidth - w - 6)) + 'px';
  tipEl.style.top = top + 'px';
}
export function hideTip() { if (tipEl) tipEl.style.display = 'none'; }

export function insertAtCursor(ta, text) {
  const a = ta.selectionStart ?? ta.value.length, b = ta.selectionEnd ?? a;
  ta.value = ta.value.slice(0, a) + text + ta.value.slice(b);
  ta.selectionStart = ta.selectionEnd = a + text.length;
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  ta.focus();
}

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const move = (arr, i, d) => { const j = i + d; if (j < 0 || j >= arr.length) return false; [arr[i], arr[j]] = [arr[j], arr[i]]; return true; };
