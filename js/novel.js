// 소설: 회차 목록/폴더, 원고 편집기, 불러오기·내보내기
import { h, uid, esc, sel, inp, field, toast, dialog, confirmDlg, promptDlg, menu, pickFiles, debounce, download, sanitizeHTML, htmlToText, countChars, textToHTML, plainFromHTML, ago, move } from './util.js';
import * as DB from './db.js';
import { D, curWork, saveSoon, imgURL } from './db.js';
import { FONT_STACKS, FONT_LABELS } from './misc.js';
import { pickDoc, bindRefs } from './wiki.js';
import { makeZip, readZip } from './zip.js';

const EP_STATUS = ['작성중', '퇴고중', '완료', '연재됨'];
const folderOf = e => e.folder || '';
const epChars = e => countChars(htmlToText(e.html || '', false).text);
const safeName = s => (s || '제목없음').replace(/[\\/:*?"<>|]/g, '_').slice(0, 60);

// ---------- 내보내기 공통 ----------
function epExport(ep) {
  const doc = new DOMParser().parseFromString('<body>' + sanitizeHTML(ep.html || '') + '</body>', 'text/html');
  const notes = [], pre = uid();
  doc.body.querySelectorAll('.fn').forEach(f => {
    notes.push(esc(f.getAttribute('data-note') || '')); const n = notes.length;
    const s = doc.createElement('sup'); s.className = 'fnref'; s.dataset.n = n; s.id = `${pre}r${n}`; s.textContent = n; f.replaceWith(s);
  });
  doc.body.querySelectorAll('img[data-img]').forEach(i => { i.src = imgURL(i.dataset.img); });
  const fnHTML = notes.length ? `<div class="fnlist">${notes.map((n, i) => `<div id="${pre}n${i + 1}"><a class="fnback">[${i + 1}]</a> ${n}</div>`).join('')}</div>` : '';
  return { html: doc.body.innerHTML, notes, pre, fnHTML };
}
function epPlain(ep) {
  const { text, notes } = htmlToText(ep.html || '');
  return text + (notes.length ? '\n\n' + notes.map((n, i) => `[${i + 1}] ${n}`).join('\n') : '');
}
const epLabel = (wk, ep) => { let n = 0; for (const e of wk.episodes) { if (!e.extra) n++; if (e === ep) return e.extra ? '[외전] ' : `${n}화 `; } return ''; };
// 제목에 이미 "1화" 같은 번호가 있으면 그대로, 없으면 번호를 앞에 붙임
const epTitle = (wk, ep) => (/^\s*(제\s*)?\d+\s*(화|회)/.test(ep.title || '') ? ep.title : (epLabel(wk, ep) + (ep.title || '')).trim());

const X = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
async function docxBlob(items) {
  const para = (t, o = {}) => `<w:p><w:pPr>${o.center ? '<w:jc w:val="center"/>' : ''}<w:spacing w:after="${o.after ?? 100}" w:line="${o.line ?? 360}" w:lineRule="auto"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="바탕" w:hAnsi="바탕" w:eastAsia="바탕"/>${o.bold ? '<w:b/>' : ''}<w:sz w:val="${o.sz || 22}"/></w:rPr><w:t xml:space="preserve">${X(t)}</w:t></w:r></w:p>`;
  const body = items.map((it, i) => (i ? '<w:p><w:r><w:br w:type="page"/></w:r></w:p>' : '') + para(it.title, { center: true, bold: true, sz: 32, after: 360 }) + it.text.split('\n').map(l => para(l)).join('')).join('');
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  return makeZip([
    { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>' },
    { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>' },
    { name: 'word/document.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${W}"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>` },
  ], 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
}
async function epubBlob(wk, eps) {
  const id = 'urn:uuid:' + uid() + uid();
  const chap = (e, i) => {
    const { text } = { text: epPlain(e) };
    return { name: `ch${i + 1}.xhtml`, title: epTitle(wk, e), data: `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml" xml:lang="ko"><head><meta charset="utf-8"/><title>${X(e.title || '')}</title><link rel="stylesheet" href="style.css"/></head><body><h2>${X(epTitle(wk, e))}</h2>${text.split('\n').map(l => l.trim() ? `<p>${X(l)}</p>` : '<p>&#160;</p>').join('')}</body></html>` };
  };
  const chs = eps.map(chap);
  return makeZip([
    { name: 'mimetype', data: 'application/epub+zip' },
    { name: 'META-INF/container.xml', data: '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>' },
    { name: 'OEBPS/style.css', data: 'body{line-height:1.8;margin:1em}h2{text-align:center;margin:1em 0 1.5em}p{margin:0 0 .6em;text-indent:1em}' },
    { name: 'OEBPS/nav.xhtml', data: `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>목차</title></head><body><nav epub:type="toc"><h1>목차</h1><ol>${chs.map(c => `<li><a href="${c.name}">${X(c.title)}</a></li>`).join('')}</ol></nav></body></html>` },
    { name: 'OEBPS/content.opf', data: `<?xml version="1.0" encoding="UTF-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid" xml:lang="ko"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="uid">${id}</dc:identifier><dc:title>${X(wk.name)}</dc:title><dc:language>ko</dc:language><meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="css" href="style.css" media-type="text/css"/>${chs.map((c, i) => `<item id="c${i}" href="${c.name}" media-type="application/xhtml+xml"/>`).join('')}</manifest><spine>${chs.map((_, i) => `<itemref idref="c${i}"/>`).join('')}</spine></package>` },
    ...chs.map(c => ({ name: 'OEBPS/' + c.name, data: c.data })),
  ], 'application/epub+zip');
}
function printHTML(title, bodyHTML) {
  const f = h('iframe', { style: { position: 'fixed', right: 0, bottom: 0, width: 0, height: 0, border: 0 } });
  document.body.append(f);
  const d = f.contentDocument; d.open();
  d.write(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${esc(title)}</title><style>@page{margin:22mm 20mm}body{font-family:'바탕','Noto Serif KR','Nanum Myeongjo',serif;font-size:11pt;line-height:1.9}h1{text-align:center;font-size:16pt;margin:0 0 1.5em}p{margin:0 0 .8em;min-height:1em}.pb{page-break-after:always}img{max-width:100%}sup{font-size:.7em}.fnlist{margin-top:2em;border-top:1px solid #999;padding-top:.6em;font-size:9.5pt}</style></head><body>${bodyHTML}</body></html>`);
  d.close();
  setTimeout(() => { f.contentWindow.focus(); f.contentWindow.print(); setTimeout(() => f.remove(), 3000); }, 400);
}
const printBody = (wk, eps) => eps.map(e => { const x = epExport(e); return `<h1>${esc(epTitle(wk, e))}</h1>${x.html}${x.fnHTML}<div class="pb"></div>`; }).join('');

// ---------- 불러오기 ----------
async function decodeText(file) {
  const buf = await file.arrayBuffer();
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf).replace(/^﻿/, ''); }
  catch { try { return new TextDecoder('euc-kr').decode(buf); } catch { return new TextDecoder().decode(buf); } }
}
async function fileToText(file) {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (ext === 'txt' || ext === 'md') return decodeText(file);
  if (ext === 'docx' || ext === 'hwpx') {
    const z = await readZip(await file.arrayBuffer());
    const parse = s => new DOMParser().parseFromString(s, 'application/xml');
    const lines = [];
    if (ext === 'docx') {
      const xml = await z.readText('word/document.xml'); if (!xml) throw new Error('docx 안에서 본문을 찾지 못했어요');
      for (const p of parse(xml).getElementsByTagName('w:p')) {
        let t = ''; for (const n of p.getElementsByTagName('*')) { if (n.nodeName === 'w:t') t += n.textContent; else if (n.nodeName === 'w:tab') t += '\t'; else if (n.nodeName === 'w:br') t += '\n'; }
        lines.push(t);
      }
    } else {
      const secs = z.names.filter(n => /^Contents\/section\d+\.xml$/i.test(n)).sort((a, b) => parseInt(a.match(/\d+/)) - parseInt(b.match(/\d+/)));
      if (!secs.length) throw new Error('hwpx 안에서 본문을 찾지 못했어요');
      for (const nm of secs) for (const p of parse(await z.readText(nm)).getElementsByTagName('hp:p')) {
        let t = ''; for (const n of p.getElementsByTagName('hp:t')) t += n.textContent; lines.push(t);
      }
    }
    return lines.join('\n');
  }
  if (ext === 'hwp') throw new Error('구형 .hwp 파일은 직접 읽을 수 없어요. 한글에서 .hwpx 또는 .txt로 저장해서 불러와 주세요');
  throw new Error('지원하지 않는 형식이에요 (txt, docx, hwpx)');
}
async function importFiles(ctx, folder) {
  const files = await pickFiles('.txt,.md,.docx,.hwpx,.hwp', true); if (!files.length) return;
  const wk = curWork(); let added = 0;
  for (const f of files) {
    try {
      const text = await fileToText(f); const title0 = f.name.replace(/\.[^.]+$/, '');
      const re = /^\s*(제\s*)?\d+\s*(화|회)(\s|[.:\-)]|$).*$/;
      const lines = text.replace(/\r\n?/g, '\n').split('\n'); const heads = lines.map((l, i) => re.test(l) && l.length < 60 ? i : -1).filter(i => i >= 0);
      let split = false;
      if (heads.length >= 2) split = await confirmDlg(`'${f.name}'에서 회차 제목 ${heads.length}개를 찾았어요.\n회차별로 나눠서 가져올까요?\n(아니오를 누르면 한 회차로 가져와요)`, '회차별로 나누기');
      if (split) {
        heads.forEach((s, k) => { const body = lines.slice(s + 1, heads[k + 1] ?? lines.length).join('\n').replace(/^\n+|\n+$/g, ''); wk.episodes.push(newEp(lines[s].trim(), textToHTML(body), folder)); added++; });
      } else { wk.episodes.push(newEp(title0, textToHTML(text.trim()), folder)); added++; }
    } catch (e) { toast(`${f.name}: ${e.message}`, 5000); }
  }
  if (added) { saveSoon(); toast(`${added}개 회차를 가져왔어요`); ctx.rerender(); }
}
function newEp(title, html, folder = '') {
  return { id: uid(), title, html: html || '<p><br></p>', folder, extra: false, status: '작성중', created: Date.now(), updated: Date.now() };
}

function exportWorkMenu(anchor) {
  const wk = curWork(), eps = wk.episodes;
  if (!eps.length) return toast('내보낼 회차가 없어요');
  menu(anchor, [
    { label: '전체 TXT (한 파일)', onClick: () => download(new Blob([eps.map(e => `${epTitle(wk, e)}\n\n${epPlain(e)}`).join('\n\n\n')], { type: 'text/plain;charset=utf-8' }), safeName(wk.name) + '.txt') },
    { label: '전체 EPUB (전자책)', onClick: async () => download(await epubBlob(wk, eps), safeName(wk.name) + '.epub') },
    { label: '전체 DOCX (한 파일)', onClick: async () => download(await docxBlob(eps.map(e => ({ title: epTitle(wk, e), text: epPlain(e) }))), safeName(wk.name) + '.docx') },
    { label: '회차별 TXT (zip)', onClick: async () => download(await makeZip(eps.map((e, i) => ({ name: `${String(i + 1).padStart(3, '0')}_${safeName(e.title)}.txt`, data: epPlain(e) }))), safeName(wk.name) + '-회차별.zip') },
    { label: '전체 PDF (인쇄 창)', onClick: () => printHTML(wk.name, printBody(wk, eps)) },
  ]);
}

// ---------- 목록 ----------
export function list(root, rt, ctx) {
  const wk = curWork();
  rt.closed ||= {};
  const body = h('div', { class: 'ep-list' });
  const q = inp(rt.q || '', v => { rt.q = v; draw(); }, { placeholder: '회차 검색', class: 'search' });
  const moveEp = (e, d) => {
    const sib = wk.episodes.filter(x => folderOf(x) === folderOf(e)); const t = sib[sib.indexOf(e) + d]; if (!t) return;
    const i = wk.episodes.indexOf(e), j = wk.episodes.indexOf(t); [wk.episodes[i], wk.episodes[j]] = [wk.episodes[j], wk.episodes[i]]; saveSoon(); draw();
  };
  const addEp = async folder => {
    const ep = newEp('', '', folder || ''); wk.episodes.push(ep); saveSoon(); ctx.go({ v: 'ep', id: ep.id });
  };
  function draw() {
    const nums = new Map(); let n = 0; wk.episodes.forEach(e => nums.set(e.id, e.extra ? '외전' : (++n) + '화'));
    const k = (rt.q || '').trim().toLowerCase();
    const groups = [{ id: '', name: '폴더 없음', loose: true }, ...wk.folders];
    const out = [];
    groups.forEach((g, gi) => {
      const all = wk.episodes.filter(e => folderOf(e) === g.id);
      const eps = all.filter(e => !k || (e.title || '').toLowerCase().includes(k) || plainFromHTML(e.html || '').toLowerCase().includes(k));
      if (g.loose && !all.length) return;
      const total = all.reduce((a, e) => a + epChars(e).nospace, 0);
      const closed = !!rt.closed[g.id];
      out.push(h('section', { class: 'folder' },
        h('div', { class: 'folder-head' },
          h('button', { class: 'iconbtn', onclick: () => { rt.closed[g.id] = !closed; draw(); } }, closed ? '▸' : '▾'),
          h('b', {}, g.name), h('small', { class: 'muted' }, `${all.length}개 · ${total.toLocaleString()}자`), h('span', { class: 'sp' }),
          h('button', { class: 'btn sm ghost', onclick: () => addEp(g.id) }, '＋ 회차'),
          g.loose ? null : h('button', { class: 'iconbtn', title: '폴더 메뉴', onclick: e => menu(e.currentTarget, [
            { label: '이름 변경', onClick: async () => { const v = await promptDlg('폴더 이름', g.name); if (v) { g.name = v; saveSoon(); draw(); } } },
            { label: '위로', onClick: () => { const i = wk.folders.indexOf(g); if (move(wk.folders, i, -1)) { saveSoon(); draw(); } } },
            { label: '아래로', onClick: () => { const i = wk.folders.indexOf(g); if (move(wk.folders, i, 1)) { saveSoon(); draw(); } } },
            { label: '회차 불러오기', onClick: () => importFiles(ctx, g.id) },
            { label: '폴더 삭제 (회차는 남김)', danger: true, onClick: async () => { if (await confirmDlg(`'${g.name}' 폴더를 삭제할까요?\n안의 회차는 '폴더 없음'으로 옮겨져요.`, '삭제', true)) { all.forEach(e => { e.folder = ''; }); wk.folders = wk.folders.filter(x => x !== g); saveSoon(); draw(); } } }]) }, '⋯')),
        closed ? null : h('div', { class: 'folder-body' }, eps.length ? eps.map(e => {
          const c = epChars(e);
          return h('div', { class: 'ep-row', onclick: () => ctx.go({ v: 'ep', id: e.id }) },
            h('span', { class: 'epnum' + (e.extra ? ' extra' : '') }, nums.get(e.id)), h('b', { class: 'ept' }, e.title || '제목 없음'),
            h('span', { class: 'badge st-' + EP_STATUS.indexOf(e.status) }, e.status || '작성중'),
            h('small', { class: 'muted num' }, c.nospace.toLocaleString() + '자'), h('small', { class: 'muted when' }, ago(e.updated)),
            h('button', { class: 'iconbtn', title: '위로', onclick: ev => { ev.stopPropagation(); moveEp(e, -1); } }, '↑'),
            h('button', { class: 'iconbtn', title: '아래로', onclick: ev => { ev.stopPropagation(); moveEp(e, 1); } }, '↓'),
            h('button', { class: 'iconbtn', onclick: ev => { ev.stopPropagation(); menu(ev.currentTarget, [
              { label: '폴더 이동', onClick: () => { const s = sel([['', '폴더 없음'], ...wk.folders.map(f => [f.id, f.name])], folderOf(e)); dialog({ title: '폴더 이동', body: s, buttons: [{ label: '취소' }, { label: '이동', kind: 'primary', onClick: c => { e.folder = s.value; saveSoon(); c(); draw(); } }] }); } },
              { label: e.extra ? '본편으로 표시' : '외전으로 표시', onClick: () => { e.extra = !e.extra; saveSoon(); draw(); } },
              { label: '복제', onClick: () => { const c2 = { ...e, id: uid(), title: (e.title || '') + ' (복제)', created: Date.now(), updated: Date.now() }; wk.episodes.splice(wk.episodes.indexOf(e) + 1, 0, c2); saveSoon(); draw(); } },
              { label: '삭제', danger: true, onClick: async () => { if (await confirmDlg(`'${e.title || '제목 없음'}' 회차를 삭제할까요?`, '삭제', true)) { wk.episodes = wk.episodes.filter(x => x !== e); saveSoon(); draw(); } } }]); } }, '⋯'));
        }) : h('div', { class: 'muted pad' }, k ? '검색 결과가 없어요' : '비어 있는 폴더예요'))));
    });
    if (!out.length) out.push(h('div', { class: 'empty' }, h('p', {}, '아직 회차가 없어요.'), h('button', { class: 'btn primary', onclick: () => addEp('') }, '첫 회차 쓰기')));
    body.replaceChildren(...out);
  }
  root.append(h('div', { class: 'view-head' }, h('h2', {}, '소설'), h('span', { class: 'muted' }, wk.name), h('span', { class: 'sp' }), q,
    h('button', { class: 'btn primary sm', onclick: () => addEp('') }, '＋ 회차'),
    h('button', { class: 'btn sm', onclick: async () => { const n = await promptDlg('폴더 이름 (예: 1부, 프롤로그)', ''); if (n) { wk.folders.push({ id: uid(), name: n }); saveSoon(); draw(); } } }, '＋ 폴더'),
    h('button', { class: 'btn sm', onclick: () => importFiles(ctx, '') }, '불러오기'),
    h('button', { class: 'btn sm', onclick: e => exportWorkMenu(e.currentTarget) }, '내보내기')), body);
  draw();
}

// ---------- 편집기 ----------
export function editor(root, rt, ctx) {
  const wk = curWork(), ep = wk.episodes.find(e => e.id === rt.id);
  if (!ep) return root.append(h('div', { class: 'empty' }, h('p', {}, '회차를 찾을 수 없어요.'), h('button', { class: 'btn', onclick: () => ctx.go({ v: 'novel' }) }, '회차 목록')));
  const st = wk.style;
  try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch { /* 무시 */ }

  const surface = h('div', { class: 'ms', contentEditable: 'true', spellcheck: 'false' });
  surface.innerHTML = sanitizeHTML(ep.html || '') || '<p><br></p>';
  const fixImgs = el => el.querySelectorAll('img[data-img]').forEach(i => { i.src = imgURL(i.dataset.img); });
  fixImgs(surface);
  const reader = h('div', { class: 'ms reader', style: { display: 'none' } });
  const stage = h('div', { class: 'ms-stage' }, surface, reader);
  const countEl = h('span', { class: 'muted counts' });
  const savedEl = h('span', { class: 'muted' }, '');

  const applyStyle = () => {
    for (const el of [surface, reader]) {
      el.style.fontFamily = FONT_STACKS[st.font] || FONT_STACKS.serif; el.style.fontSize = st.size + 'px'; el.style.lineHeight = st.lh; el.style.textAlign = st.align;
      el.classList.toggle('indent', !!st.indent);
    }
    stage.style.maxWidth = st.width ? st.width + 'px' : 'none';
  };
  const serialize = () => { const c = surface.cloneNode(true); c.querySelectorAll('img[data-img]').forEach(i => i.removeAttribute('src')); return c.innerHTML; };
  const updCounts = () => { const c = countChars(htmlToText(serialize(), false).text); countEl.textContent = `${c.all.toLocaleString()}자 (공백 제외 ${c.nospace.toLocaleString()}자)`; };
  const save = debounce(() => {
    if (!surface.innerHTML.trim()) surface.innerHTML = '<p><br></p>';
    ep.html = serialize(); ep.updated = Date.now(); saveSoon(); savedEl.textContent = '저장됨'; ctx.changed();
  }, 600);
  surface.addEventListener('input', () => { savedEl.textContent = '저장 중…'; updCounts(); save(); });
  surface.addEventListener('paste', e => {
    e.preventDefault();
    const t = e.clipboardData.getData('text/plain'); if (!t) return;
    document.execCommand('insertHTML', false, textToHTML(t));
  });

  let saved = null;
  const onSel = () => { const s = getSelection(); if (s.rangeCount && surface.contains(s.anchorNode)) saved = s.getRangeAt(0).cloneRange(); };
  document.addEventListener('selectionchange', onSel);
  const restore = () => {
    surface.focus(); const s = getSelection(); s.removeAllRanges();
    if (saved) s.addRange(saved); else { const r = document.createRange(); r.selectNodeContents(surface); r.collapse(false); s.addRange(r); }
  };
  const exec = (cmd, val) => { restore(); document.execCommand(cmd, false, val); save(); updCounts(); };
  const tb = (label, title, fn, extra = '') => h('button', { class: 'tbtn ' + extra, title, onmousedown: e => e.preventDefault(), onclick: fn }, label);

  // 커서 위치에 노드를 넣고 그 뒤로 커서를 옮김 (선택 영역이 있으면 대체)
  const insertNode = node => {
    restore(); const sel = getSelection();
    let r = sel.rangeCount ? sel.getRangeAt(0) : null;
    if (!r || !surface.contains(r.commonAncestorContainer)) { r = document.createRange(); r.selectNodeContents(surface); r.collapse(false); }
    const startEl = r.startContainer.nodeType === 1 ? r.startContainer : r.startContainer.parentElement;
    const inFn = startEl && startEl.closest && startEl.closest('.fn');
    if (inFn) { r.setStartAfter(inFn); r.collapse(true); }
    if (r.startContainer === surface) { const lp = surface.lastElementChild; if (lp && lp.tagName === 'P') { r.selectNodeContents(lp); r.collapse(false); } }
    r.deleteContents(); r.insertNode(node);
    const z = document.createTextNode('\u200b'); node.after(z);
    const nr = document.createRange(); nr.setStart(z, 1); nr.collapse(true); sel.removeAllRanges(); sel.addRange(nr); saved = nr.cloneRange();
    save(); updCounts();
  };
  const insertFootnote = async (existing) => {
    const t = await promptDlg('각주 내용', existing ? existing.dataset.note : '', { multiline: true, title: existing ? '각주 고치기' : '각주 넣기' });
    if (t == null) return;
    if (existing) { if (t) existing.dataset.note = t; else existing.remove(); save(); updCounts(); return; }
    if (!t) return;
    insertNode(h('sup', { class: 'fn', contentEditable: 'false', data: { note: t } }, '\u200b'));
  };
  surface.addEventListener('click', e => { const f = e.target.closest('.fn'); if (f) insertFootnote(f); });
  const insertLink = () => pickDoc(d => {
    restore(); const sTxt = getSelection().toString();
    insertNode(h('a', { class: 'doclink', data: { doc: d.id } }, sTxt || d.title));
  }, { title: '문서 연결' });
  const insertImage = async () => {
    const [f] = await pickFiles('image/*'); if (!f) return;
    const id = await DB.addImageFile(f);
    restore(); document.execCommand('insertHTML', false, `<p style="text-align:center"><img data-img="${id}" src="${imgURL(id)}" alt=""></p>`); save();
  };

  const styleSel = (opts, key, cast = v => v) => sel(opts, String(st[key]), v => { st[key] = cast(v); saveSoon(); applyStyle(); });
  const sizeIn = h('input', { type: 'number', min: 12, max: 30, value: st.size, class: 'narrow', title: '글자 크기', onchange: e => { st.size = Math.max(12, Math.min(30, +e.target.value || 17)); saveSoon(); applyStyle(); } });
  const toolbar = h('div', { class: 'ed-tools' },
    styleSel(FONT_LABELS, 'font'), sizeIn,
    styleSel([['1.5', '줄 1.5'], ['1.7', '줄 1.7'], ['1.9', '줄 1.9'], ['2.1', '줄 2.1'], ['2.4', '줄 2.4']], 'lh', Number),
    styleSel([['560', '폭 좁게'], ['720', '폭 보통'], ['880', '폭 넓게'], ['0', '폭 꽉 차게']], 'width', Number),
    h('span', { class: 'sepv' }),
    tb('B', '굵게', () => exec('bold'), 'b'), tb('I', '기울임', () => exec('italic'), 'i'), tb('U', '밑줄', () => exec('underline'), 'u'), tb('S', '취소선', () => exec('strikeThrough'), 's'),
    h('span', { class: 'sepv' }),
    tb('⇤', '왼쪽 정렬', () => exec('justifyLeft')), tb('↔', '가운데 정렬', () => exec('justifyCenter')), tb('⇥', '오른쪽 정렬', () => exec('justifyRight')),
    tb('¶▸', '문단 첫 줄 들여쓰기 켜기/끄기', () => { st.indent = !st.indent; saveSoon(); applyStyle(); }),
    tb('＊＊＊', '장면 구분선 넣기', () => { restore(); document.execCommand('insertHTML', false, '<p style="text-align:center">＊ ＊ ＊</p><p><br></p>'); save(); }),
    h('span', { class: 'sepv' }),
    tb('🖼', '이미지 넣기', insertImage), tb('📝', '각주 넣기', () => insertFootnote(null)), tb('🔗', '문서 연결 (캐릭터·설정 링크)', insertLink),
    tb('↶', '되돌리기', () => exec('undo')), tb('↷', '다시 실행', () => exec('redo')));

  // 머리줄
  const titleIn = inp(ep.title, v => { ep.title = v; ep.updated = Date.now(); saveSoon(); ctx.changed(); }, { class: 'ed-title', placeholder: '회차 제목 (번호는 자동으로 붙어요)' });
  const idx = wk.episodes.indexOf(ep);
  const go = d => { const t = wk.episodes[idx + d]; if (t) ctx.go({ v: 'ep', id: t.id }); else toast(d < 0 ? '첫 회차예요' : '마지막 회차예요'); };
  let reading = false;
  const readBtn = h('button', { class: 'btn sm', onclick: () => toggleReading() }, '게시글 보기');
  const toggleReading = () => {
    reading = !reading;
    if (reading) {
      save.flush(); const x = epExport(ep); reader.innerHTML = `<h1 class="rtitle">${esc(ep.title || '')}</h1>${x.html}${x.fnHTML}`; reader._notes = x.notes;
      surface.style.display = 'none'; reader.style.display = ''; toolbar.classList.add('off'); readBtn.textContent = '편집으로';
    } else { surface.style.display = ''; reader.style.display = 'none'; toolbar.classList.remove('off'); readBtn.textContent = '게시글 보기'; }
  };
  bindRefs(reader, ctx, () => reader._notes || []);
  bindRefs(surface, ctx, () => [], { click: false });

  const mobilePreview = () => {
    save.flush(); const x = epExport(ep);
    const screen = h('div', { class: 'phone-screen', html: `<h1 class="rtitle">${esc(ep.title || '')}</h1>${x.html}${x.fnHTML}` });
    screen.style.fontFamily = FONT_STACKS[st.font];
    let fs = 16; const setFs = d => { fs = Math.max(12, Math.min(24, fs + d)); screen.style.fontSize = fs + 'px'; }; setFs(0);
    let dark = true; const setDark = () => { screen.classList.toggle('light', !dark); };
    setDark();
    bindRefs(screen, { go() { }, beside() { } }, () => x.notes);
    dialog({ title: '모바일 미리보기', wide: true, body: h('div', { class: 'phone-wrap' }, h('div', { class: 'row' }, h('button', { class: 'btn sm', onclick: () => setFs(-1) }, '가−'), h('button', { class: 'btn sm', onclick: () => setFs(1) }, '가＋'), h('button', { class: 'btn sm', onclick: () => { dark = !dark; setDark(); } }, '밝게/어둡게')), h('div', { class: 'phone' }, screen)), buttons: [{ label: '닫기', kind: 'primary' }] });
  };

  const exportMenu = a => menu(a, [
    { label: '본문 복사 (플랫폼에 붙여넣기)', onClick: async () => { try { await navigator.clipboard.writeText(epPlain(ep)); toast('복사했어요'); } catch { toast('복사하지 못했어요 — 브라우저 권한을 확인해 주세요'); } } },
    { label: 'TXT로 저장', onClick: () => { save.flush(); download(new Blob([`${ep.title || ''}\n\n${epPlain(ep)}`], { type: 'text/plain;charset=utf-8' }), safeName(ep.title) + '.txt'); } },
    { label: 'DOCX로 저장', onClick: async () => { save.flush(); download(await docxBlob([{ title: ep.title || '', text: epPlain(ep) }]), safeName(ep.title) + '.docx'); } },
    { label: 'PDF로 저장 (인쇄 창)', onClick: () => { save.flush(); printHTML(ep.title, printBody(wk, [ep])); } },
    { sep: true },
    { label: '작품 전체 내보내기…', onClick: () => exportWorkMenu(a) }]);

  const head = h('div', { class: 'ed-head' },
    h('button', { class: 'btn sm ghost', onclick: () => ctx.go({ v: 'novel' }) }, '← 회차'),
    h('button', { class: 'iconbtn', title: '이전 회차', onclick: () => go(-1) }, '‹'), h('button', { class: 'iconbtn', title: '다음 회차', onclick: () => go(1) }, '›'),
    titleIn,
    sel(EP_STATUS, ep.status || '작성중', v => { ep.status = v; saveSoon(); }),
    h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: !!ep.extra, onchange: e => { ep.extra = e.target.checked; saveSoon(); } }), '외전'),
    sel([['', '폴더 없음'], ...wk.folders.map(f => [f.id, f.name])], folderOf(ep), v => { ep.folder = v; saveSoon(); }),
    h('span', { class: 'sp' }), savedEl, countEl,
    h('button', { class: 'btn sm', onclick: () => { document.body.classList.add('focus'); if (reading) toggleReading(); surface.focus(); } }, '집중 모드'),
    h('button', { class: 'btn sm', onclick: mobilePreview }, '모바일 미리보기'), readBtn,
    h('button', { class: 'btn sm', onclick: e => exportMenu(e.currentTarget) }, '내보내기'));

  root.append(head, toolbar, stage);
  applyStyle(); updCounts();
  return () => { save.flush(); document.removeEventListener('selectionchange', onSel); };
}
