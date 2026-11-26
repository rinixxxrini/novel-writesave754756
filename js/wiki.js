// 캐릭터·작품설정 위키: 목록, 문서 보기/편집, 각주, 문서 연결, 템플릿
import { h, uid, esc, unesc, sel, inp, area, field, toast, dialog, confirmDlg, promptDlg, menu, pickFiles, debounce, showTip, hideTip, insertAtCursor, move, plainFromHTML } from './util.js';
import * as DB from './db.js';
import { D, inWorld, docById, docByTitle, saveSoon, imgURL } from './db.js';

const TYPE_LABEL = { character: '캐릭터', setting: '작품설정' };

// ---------- 인라인 마크업: [[문서]] [[문서|표시]] ((각주)) ----------
export function inline(text, fc) {
  let out = esc(text);
  out = out.replace(/\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g, (m, t, label) => {
    const title = unesc(t).trim(), d = docByTitle(title);
    return d ? `<a class="wlink" data-doc="${d.id}">${label || t}</a>` : `<a class="wlink miss" data-title="${esc(title)}">${label || t}</a>`;
  });
  out = out.replace(/\(\(([\s\S]+?)\)\)/g, (m, c) => {
    if (!fc) return '';
    fc.notes.push(c); const n = fc.notes.length;
    return `<sup class="fnref" data-n="${n}" id="${fc.pre}r${n}">${n}</sup>`;
  });
  return out;
}
export const plainMarkup = t => String(t || '').replace(/\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g, (m, a, b) => b || a).replace(/\(\([\s\S]+?\)\)/g, '');

function createMissing(title, ctx) {
  const mk = type => { const doc = DB.newDoc(type, title, null); D.docs.push(doc); saveSoon(); ctx.go({ v: 'doc', id: doc.id, edit: true }); };
  const d = dialog({ title: '아직 없는 문서예요', body: h('p', { style: { margin: 0 } }, `'${title}' 문서를 새로 만들까요?`), buttons: [
    { label: '취소' }, { label: '작품설정으로 만들기', onClick: c => { c(); mk('setting'); } }, { label: '캐릭터로 만들기', kind: 'primary', onClick: c => { c(); mk('character'); } }] });
  return d;
}

// 링크·각주 호버/클릭 동작을 컨테이너에 연결 (opts.click=false 이면 일반 클릭은 이동 안 함: 편집기용)
export function bindRefs(container, ctx, getNotes, opts = {}) {
  const click = opts.click !== false;
  container.addEventListener('mouseover', e => {
    const a = e.target.closest?.('.wlink,.doclink');
    if (a) {
      const d = a.dataset.doc ? docById(a.dataset.doc) : null;
      showTip(a, d ? `<b>${esc(d.title)}</b>${d.summary ? '<br>' + esc(plainMarkup(d.summary)) : ''}` : '아직 없는 문서예요 — 클릭하면 새로 만들 수 있어요'); return;
    }
    const f = e.target.closest?.('.fnref,.fn');
    if (f) showTip(f, f.classList.contains('fn') ? esc(f.dataset.note || '') : (getNotes()[+f.dataset.n - 1] || ''));
  });
  container.addEventListener('mouseout', e => { if (e.target.closest?.('.wlink,.doclink,.fnref,.fn')) hideTip(); });
  container.addEventListener('click', e => {
    const a = e.target.closest?.('.wlink,.doclink');
    if (a) {
      const modifier = e.ctrlKey || e.metaKey || e.shiftKey;
      if (!click && !modifier) return;
      e.preventDefault(); hideTip();
      const id = a.dataset.doc;
      if (id && docById(id)) { const rt = { v: 'doc', id }; modifier ? ctx.beside(rt) : ctx.go(rt); }
      else if (a.dataset.title) createMissing(a.dataset.title, ctx);
      return;
    }
    const f = e.target.closest?.('.fnref');
    if (f) document.getElementById(f.id.replace(/r(\d+)$/, 'n$1'))?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
}

// 문서 고르기 대화상자
export function pickDoc(onPick, { title = '문서 연결', exclude } = {}) {
  const docs = inWorld('docs').filter(d => d.id !== exclude);
  const cats = [...new Set(docs.map(d => d.category).filter(Boolean))].sort();
  const listEl = h('div', { class: 'pick-list' });
  const type = sel([['', '전체 종류'], ['character', '캐릭터'], ['setting', '작품설정']], '', () => draw());
  const cat = sel([['', '전체 분류'], ...cats], '', () => draw());
  const q = inp('', () => draw(), { placeholder: '이름·분류·요약으로 찾기' });
  function draw() {
    const k = q.value.trim().toLowerCase();
    const rows = docs.filter(d => (!type.value || d.type === type.value) && (!cat.value || d.category === cat.value)
      && (!k || (d.title + ' ' + d.category + ' ' + d.summary + ' ' + d.tags.join(' ')).toLowerCase().includes(k)));
    listEl.replaceChildren(...(rows.length ? rows.map(d => h('button', { class: 'pick-item', onclick: () => { dlg.close(); onPick(d); } },
      h('span', { class: 'badge' }, TYPE_LABEL[d.type] + (d.category ? ' · ' + d.category : '')), h('b', {}, d.title), h('small', { class: 'muted' }, plainMarkup(d.summary))))
      : [h('div', { class: 'empty' }, docs.length ? '조건에 맞는 문서가 없어요' : '아직 만든 문서가 없어요')]));
  }
  const dlg = dialog({ title, body: h('div', { class: 'stack' }, h('div', { class: 'row' }, type, cat), q, listEl), buttons: [{ label: '취소' }], wide: true });
  draw(); setTimeout(() => q.focus(), 30);
}

// ---------- 목록 ----------
function templatesDlg(type, rerender) {
  const box = h('div', { class: 'stack sm' });
  const draw = () => {
    const ts = D.templates.filter(t => t.type === type);
    box.replaceChildren(...(ts.length ? ts.map(t => h('div', { class: 'row' },
      h('b', {}, t.name), h('small', { class: 'muted' }, `정보 ${t.keys.length}개 · 목차 ${t.sections.length}개`), h('span', { class: 'sp' }),
      h('button', { class: 'btn sm', onclick: async () => { const n = await promptDlg('템플릿 이름', t.name); if (n) { t.name = n; saveSoon(); draw(); } } }, '이름 변경'),
      h('button', { class: 'btn sm danger', onclick: async () => { if (await confirmDlg(`'${t.name}' 템플릿을 삭제할까요?`, '삭제', true)) { D.templates = D.templates.filter(x => x !== t); saveSoon(); draw(); } } }, '삭제')))
      : [h('div', { class: 'muted' }, '템플릿이 없어요. 문서를 편집하는 화면에서 "템플릿으로 저장"을 눌러 만들 수 있어요.')]));
  };
  draw();
  dialog({ title: TYPE_LABEL[type] + ' 템플릿', body: box, buttons: [{ label: '닫기', kind: 'primary', onClick: c => { c(); rerender && rerender(); } }], onClose: () => rerender && rerender() });
}

export function list(root, rt, ctx) {
  const type = rt.t || 'character';
  const all = inWorld('docs').filter(d => d.type === type);
  const cats = [...new Set(all.map(d => d.category).filter(Boolean))].sort();
  const tags = [...new Set(all.flatMap(d => d.tags))].sort();
  const grid = h('div', { class: 'doc-grid' });
  const q = inp(rt.q || '', v => { rt.q = v; draw(); }, { placeholder: '검색', class: 'search' });
  const cat = sel([['', '전체 분류'], ...cats], rt.cat || '', v => { rt.cat = v; draw(); });
  const tag = sel([['', '전체 태그'], ...tags], rt.tag || '', v => { rt.tag = v; draw(); });
  const sort = sel([['title', '이름순'], ['updated', '최근 수정순']], rt.sort || 'title', v => { rt.sort = v; draw(); });
  function draw() {
    const k = (rt.q || '').trim().toLowerCase();
    let rows = all.filter(d => (!rt.cat || d.category === rt.cat) && (!rt.tag || d.tags.includes(rt.tag)) && (!k || DB.docPlain(d).toLowerCase().includes(k)));
    rows = rows.sort(rt.sort === 'updated' ? (a, b) => b.updated - a.updated : (a, b) => a.title.localeCompare(b.title, 'ko'));
    grid.replaceChildren(...(rows.length ? rows.map(d => h('button', { class: 'doc-card', onclick: e => { const r = { v: 'doc', id: d.id }; (e.ctrlKey || e.metaKey) ? ctx.beside(r) : ctx.go(r); } },
      h('div', { class: 'thumb' }, d.images[0] ? h('img', { src: imgURL(d.images[0]), alt: '' }) : h('span', {}, [...d.title][0] || '?')),
      h('div', { class: 'dc-body' }, h('b', {}, d.title), d.category ? h('span', { class: 'badge' }, d.category) : null,
        h('p', {}, plainMarkup(d.summary)), d.tags.length ? h('div', { class: 'chips sm' }, d.tags.slice(0, 4).map(t => h('span', { class: 'chip' }, '#' + t))) : null)))
      : [h('div', { class: 'empty' }, all.length ? '조건에 맞는 문서가 없어요' : `아직 ${TYPE_LABEL[type]} 문서가 없어요. 오른쪽 위의 "새 문서"로 시작해 보세요.`)]));
  }
  const create = () => {
    const tpls = D.templates.filter(t => t.type === type);
    const ts = sel([['', '빈 문서'], ...tpls.map(t => [t.id, t.name])], tpls[0]?.id || '');
    const ti = h('input', { type: 'text', placeholder: '이름' });
    const ok = c => {
      const name = ti.value.trim(); if (!name) return toast('이름을 입력해 주세요');
      const doc = DB.newDoc(type, name, tpls.find(t => t.id === ts.value)); doc.category = rt.cat || '';
      D.docs.push(doc); saveSoon(); ctx.changed(); c(); ctx.go({ v: 'doc', id: doc.id, edit: true });
    };
    const dlg = dialog({ title: `새 ${TYPE_LABEL[type]} 문서`, body: h('div', { class: 'stack' }, field('이름', ti), field('템플릿', ts)), buttons: [{ label: '취소' }, { label: '만들기', kind: 'primary', onClick: ok }] });
    ti.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) ok(dlg.close); });
    setTimeout(() => ti.focus(), 30);
  };
  root.append(
    h('div', { class: 'view-head' }, h('h2', {}, TYPE_LABEL[type]), h('span', { class: 'muted' }, `${all.length}개`), h('span', { class: 'sp' }),
      q, cat, tag, sort, h('button', { class: 'btn sm', onclick: () => templatesDlg(type, () => ctx.rerender()) }, '템플릿'), h('button', { class: 'btn primary sm', onclick: create }, '＋ 새 문서')),
    grid);
  draw();
}

// ---------- 블록 렌더 ----------
function renderBlocks(blocks, fc) {
  return (blocks || []).map(b => {
    if (b.type === 'text') return h('div', { class: 'txt', html: inline(b.text || '', fc) });
    if (b.type === 'image') return h('figure', { class: 'wfig' }, b.img ? h('img', { src: imgURL(b.img), alt: b.caption || '' }) : null, b.caption ? h('figcaption', { html: inline(b.caption, fc) }) : null);
    if (b.type === 'table') {
      const rows = b.rows || [];
      return h('div', { class: 'tablewrap' }, h('table', { class: 'wtable' }, rows.map((r, ri) => h('tr', {}, r.map(c => h(b.header && ri === 0 ? 'th' : 'td', { html: inline(c, fc) }))))));
    }
    if (b.type === 'status') return h('div', { class: 'status' }, (b.rows || []).map(r => {
      const max = +r.max || 100, v = +r.v; const pct = Math.max(0, Math.min(100, (isNaN(v) ? 0 : v) / max * 100));
      return h('div', { class: 'strow' }, h('span', { class: 'sk' }, r.k), h('div', { class: 'bar' }, h('i', { style: { width: pct + '%' } })), h('b', {}, (r.v ?? '') + (r.max ? ' / ' + r.max : '')));
    }));
    if (b.type === 'gap') return h('div', { class: 'gap' });
    return null;
  });
}

// ---------- 문서 보기/편집 ----------
export function doc(root, rt, ctx) {
  const d = docById(rt.id);
  if (!d) return root.append(h('div', { class: 'empty' }, h('p', {}, '문서를 찾을 수 없어요.'), h('button', { class: 'btn', onclick: () => ctx.go({ v: 'docs', t: 'character' }) }, '목록으로')));
  return rt.edit ? editDoc(root, d, ctx) : viewDoc(root, d, ctx);
}

function viewDoc(root, d, ctx) {
  const fc = { notes: [], pre: uid() };
  const summary = d.summary ? h('p', { class: 'doc-summary', html: inline(d.summary, fc) }) : null;
  const rows = d.infobox.filter(r => r.k || r.v);
  const infoRows = rows.map(r => h('tr', {}, h('th', {}, r.k), h('td', { html: inline(r.v || '', fc) })));
  let gi = 0;
  const gimg = h('img', { alt: '' }), gcount = h('span', {});
  const setG = n => { gi = (n + d.images.length) % d.images.length; gimg.src = imgURL(d.images[gi]); gcount.textContent = `${gi + 1} / ${d.images.length}`; };
  const gallery = d.images.length ? h('div', { class: 'ib-gallery' }, gimg, d.images.length > 1 ? h('div', { class: 'ib-nav' }, h('button', { onclick: () => setG(gi - 1) }, '‹'), gcount, h('button', { onclick: () => setG(gi + 1) }, '›')) : null) : null;
  if (gallery) setG(0);
  const info = (gallery || infoRows.length) ? h('aside', { class: 'infobox' }, gallery, h('div', { class: 'ib-title' }, d.title), infoRows.length ? h('table', {}, infoRows) : null) : null;

  const toc = [];
  const scroller = () => root;
  const sec = (s, num, lvl) => {
    const id = fc.pre + 's' + num.replace('.', '_');
    toc.push({ num, title: s.title, id, lvl });
    const body = h('div', { class: 'sec-body' }, renderBlocks(s.blocks, fc));
    const wrapEl = h('div', { class: 'sec' + (s.collapsed ? ' closed' : '') });
    const head = h(lvl === 2 ? 'h2' : 'h3', { class: 'sec-h', id, onclick: e => { if (e.target.closest('.totop')) return; wrapEl.classList.toggle('closed'); } },
      h('span', { class: 'chev' }, '⌄'), h('span', { class: 'num' }, num), h('span', { class: 'st' }, s.title),
      h('a', { class: 'totop', title: '맨 위로', onclick: e => { e.preventDefault(); scroller().scrollTo({ top: 0, behavior: 'smooth' }); } }, '↑'));
    wrapEl.append(head, body);
    return wrapEl;
  };
  const secEls = d.sections.map((s, i) => {
    const el = sec(s, `${i + 1}.`, 2);
    (s.children || []).forEach((c, j) => el.querySelector('.sec-body').append(sec(c, `${i + 1}.${j + 1}`, 3)));
    return el;
  });
  const tocEl = toc.length >= 2 ? h('nav', { class: 'toc' }, h('b', {}, '목차'), toc.map(t => h('a', { class: 'l' + t.lvl, onclick: () => { const el = document.getElementById(t.id); el?.closest('.sec')?.classList.remove('closed'); el?.scrollIntoView({ behavior: 'smooth', block: 'start' }); } }, `${t.num} ${t.title}`))) : null;

  const fnList = fc.notes.length ? h('div', { class: 'fnlist' }, fc.notes.map((n, i) => h('div', { id: `${fc.pre}n${i + 1}` }, h('a', { class: 'fnback', onclick: () => document.getElementById(`${fc.pre}r${i + 1}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }) }, `[${i + 1}]`), ' ', h('span', { html: n })))) : null;

  const pat = new RegExp('\\[\\[' + d.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(\\||\\]\\])');
  const back = inWorld('docs').filter(o => o.id !== d.id && pat.test(DB.docPlain(o)));
  const eps = DB.curWork().episodes.filter(e => (e.html || '').includes(`data-doc="${d.id}"`) || (d.type === 'character' && plainFromHTML(e.html || '').includes(d.title)));
  const refs = (back.length || eps.length) ? h('div', { class: 'backrefs' },
    back.length ? h('div', {}, h('b', {}, '이 문서를 연결한 문서 '), back.map(o => h('button', { class: 'chip link', onclick: e => { const r = { v: 'doc', id: o.id }; e.ctrlKey ? ctx.beside(r) : ctx.go(r); } }, o.title))) : null,
    eps.length ? h('div', {}, h('b', {}, '등장하는 회차 '), eps.slice(0, 30).map(e => h('button', { class: 'chip link', onclick: () => ctx.beside({ v: 'ep', id: e.id }) }, e.title || '제목 없음'))) : null) : null;

  root.append(
    h('div', { class: 'view-head' },
      h('button', { class: 'btn sm ghost', onclick: () => ctx.go({ v: 'docs', t: d.type }) }, '← ' + TYPE_LABEL[d.type]), h('span', { class: 'sp' }),
      h('button', { class: 'btn sm', onclick: () => ctx.beside({ v: 'doc', id: d.id }) }, '옆 화면에 열기'),
      h('button', { class: 'btn sm primary', onclick: () => ctx.go({ v: 'doc', id: d.id, edit: true }) }, '편집'),
      h('button', { class: 'btn sm danger', onclick: async () => {
        if (!await confirmDlg(`'${d.title}' 문서를 삭제할까요?`, '삭제', true)) return;
        D.docs = D.docs.filter(x => x !== d); D.graphs.forEach(g => { g.nodes = g.nodes.filter(n => n.doc !== d.id); const ids = new Set(g.nodes.map(n => n.id)); g.edges = g.edges.filter(e => ids.has(e.a) && ids.has(e.b)); });
        saveSoon(); ctx.changed(); ctx.go({ v: 'docs', t: d.type });
      } }, '삭제')),
    h('div', { class: 'docpage' },
      h('div', { class: 'doc-titlebar' }, h('h1', {}, d.title), d.category ? h('span', { class: 'badge' }, d.category) : null, d.tags.map(t => h('span', { class: 'chip' }, '#' + t))),
      summary,
      h('div', { class: 'docgrid' + (info ? '' : ' noinfo') }, h('div', { class: 'docmain' }, tocEl, secEls, fnList, refs), info)));
  const notes = fc.notes;
  bindRefs(root, ctx, () => notes);
}

// ---------- 편집 ----------
function toolsFor(ta, exclude) {
  return h('div', { class: 'mini-tools' },
    h('button', { class: 'btn sm', title: '다른 문서로 연결되는 링크 [[이름]] 넣기', onclick: () => pickDoc(doc => insertAtCursor(ta, `[[${doc.title}]]`), { exclude }) }, '🔗 문서 연결'),
    h('button', { class: 'btn sm', title: '각주 ((내용)) 넣기', onclick: async () => { const t = await promptDlg('각주 내용', '', { multiline: true, title: '각주 넣기' }); if (t) insertAtCursor(ta, `((${t}))`); } }, '📝 각주'));
}

function editDoc(root, doc, ctx) {
  const d = structuredClone(doc);
  let dirty = false, discarded = false;
  const wrap = h('div', { class: 'docedit' });
  root.append(wrap);
  const mark = () => { dirty = true; };
  wrap.addEventListener('input', mark);

  const commit = () => {
    const old = doc.title;
    Object.assign(doc, d, { updated: Date.now() });
    if (!doc.title.trim()) doc.title = '제목 없음';
    DB.renameDocRefs(old, doc.title);
    dirty = false; saveSoon(); ctx.changed();
  };
  const render = () => { const top = root.scrollTop; wrap.replaceChildren(...build()); root.scrollTop = top; };
  const rerenderDirty = fn => () => { fn(); mark(); render(); };

  function blockEditor(sec, bi) {
    const b = sec.blocks[bi];
    const names = { text: '글', image: '이미지', table: '표', status: '스테이터스', gap: '빈 줄' };
    const ctl = h('div', { class: 'blk-ctl' }, h('b', {}, names[b.type]), h('span', { class: 'sp' }),
      h('button', { class: 'iconbtn', title: '위로', onclick: rerenderDirty(() => move(sec.blocks, bi, -1)) }, '↑'),
      h('button', { class: 'iconbtn', title: '아래로', onclick: rerenderDirty(() => move(sec.blocks, bi, 1)) }, '↓'),
      h('button', { class: 'iconbtn', title: '삭제', onclick: rerenderDirty(() => sec.blocks.splice(bi, 1)) }, '✕'));
    let body;
    if (b.type === 'text') {
      const ta = area(b.text, v => { b.text = v; }, { rows: Math.max(3, Math.min(14, (b.text || '').split('\n').length + 1)), placeholder: '내용을 적어요. [[문서이름]]으로 링크, ((내용))으로 각주를 넣을 수 있어요.' });
      body = h('div', { class: 'stack sm' }, toolsFor(ta, doc.id), ta);
    } else if (b.type === 'image') {
      body = h('div', { class: 'stack sm' },
        b.img ? h('img', { class: 'blk-img', src: imgURL(b.img), alt: '' }) : h('div', { class: 'muted' }, '이미지를 선택해 주세요'),
        h('div', { class: 'row' }, h('button', { class: 'btn sm', onclick: async () => { const [f] = await pickFiles('image/*'); if (!f) return; b.img = await DB.addImageFile(f); mark(); render(); } }, b.img ? '이미지 바꾸기' : '이미지 선택')),
        inp(b.caption || '', v => { b.caption = v; }, { placeholder: '설명(선택)' }));
    } else if (b.type === 'table') {
      b.rows ||= [['', ''], ['', '']];
      const cols = b.rows[0].length;
      body = h('div', { class: 'stack sm' },
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: !!b.header, onchange: e => { b.header = e.target.checked; mark(); } }), '첫 줄을 제목 칸으로'),
        h('div', { class: 'tablewrap' }, h('table', { class: 'tbl edit' },
          h('tr', {}, b.rows[0].map((_, ci) => h('td', { class: 'colctl' }, cols > 1 ? h('button', { class: 'iconbtn', title: '이 열 삭제', onclick: rerenderDirty(() => b.rows.forEach(r => r.splice(ci, 1))) }, '✕') : null)), h('td', {})),
          b.rows.map((r, ri) => h('tr', {}, r.map((c, ci) => h('td', {}, inp(c, v => { b.rows[ri][ci] = v; }))), h('td', { class: 'colctl' }, b.rows.length > 1 ? h('button', { class: 'iconbtn', title: '이 줄 삭제', onclick: rerenderDirty(() => b.rows.splice(ri, 1)) }, '✕') : null))))),
        h('div', { class: 'row' },
          h('button', { class: 'btn sm', onclick: rerenderDirty(() => b.rows.push(Array(cols).fill(''))) }, '＋ 줄'),
          h('button', { class: 'btn sm', onclick: rerenderDirty(() => b.rows.forEach(r => r.push(''))) }, '＋ 열')));
    } else if (b.type === 'status') {
      b.rows ||= [{ k: '', v: '', max: '' }];
      body = h('div', { class: 'stack sm' }, b.rows.map((r, ri) => h('div', { class: 'row' },
        inp(r.k, v => { r.k = v; }, { placeholder: '항목 (예: 체력)' }), inp(r.v, v => { r.v = v; }, { placeholder: '값', class: 'narrow' }), inp(r.max, v => { r.max = v; }, { placeholder: '최대(선택)', class: 'narrow' }),
        h('button', { class: 'iconbtn', onclick: rerenderDirty(() => b.rows.splice(ri, 1)) }, '✕'))),
        h('button', { class: 'btn sm', onclick: rerenderDirty(() => b.rows.push({ k: '', v: '', max: '' })) }, '＋ 항목'));
    } else body = h('div', { class: 'muted' }, '(빈 줄 — 문단 사이에 여백을 줘요)');
    return h('div', { class: 'blk' }, ctl, body);
  }

  function sectionEditor(arr, si, top) {
    const s = arr[si];
    const addMenu = e => menu(e.currentTarget, [
      { label: '글', onClick: rerenderDirty(() => s.blocks.push({ id: uid(), type: 'text', text: '' })) },
      { label: '이미지', onClick: rerenderDirty(() => s.blocks.push({ id: uid(), type: 'image', img: '', caption: '' })) },
      { label: '표', onClick: rerenderDirty(() => s.blocks.push({ id: uid(), type: 'table', header: true, rows: [['', ''], ['', '']] })) },
      { label: '스테이터스', onClick: rerenderDirty(() => s.blocks.push({ id: uid(), type: 'status', rows: [{ k: '', v: '', max: '' }] })) },
      { label: '빈 줄', onClick: rerenderDirty(() => s.blocks.push({ id: uid(), type: 'gap' })) }]);
    return h('div', { class: 'sec-edit' + (top ? '' : ' child') },
      h('div', { class: 'row' }, h('span', { class: 'num' }, top ? `${si + 1}.` : '↳'), inp(s.title, v => { s.title = v; }, { placeholder: '목차 제목', class: 'grow' }),
        h('label', { class: 'check', title: '문서를 열 때 접어 두기' }, h('input', { type: 'checkbox', checked: !!s.collapsed, onchange: e => { s.collapsed = e.target.checked; mark(); } }), '접기'),
        h('button', { class: 'iconbtn', title: '위로', onclick: rerenderDirty(() => move(arr, si, -1)) }, '↑'),
        h('button', { class: 'iconbtn', title: '아래로', onclick: rerenderDirty(() => move(arr, si, 1)) }, '↓'),
        h('button', { class: 'iconbtn', title: '삭제', onclick: rerenderDirty(() => arr.splice(si, 1)) }, '🗑')),
      s.blocks.map((_, bi) => blockEditor(s, bi)),
      h('div', { class: 'row' }, h('button', { class: 'btn sm', onclick: addMenu }, '＋ 블록 추가'),
        top ? h('button', { class: 'btn sm', onclick: rerenderDirty(() => { (s.children ||= []).push({ id: uid(), title: '', collapsed: false, blocks: [{ id: uid(), type: 'text', text: '' }] }); }) }, '＋ 하위 목차') : null),
      top ? (s.children || []).map((_, ci) => sectionEditor(s.children, ci, false)) : null);
  }

  function build() {
    const cats = [...new Set(inWorld('docs').map(x => x.category).filter(Boolean))];
    const dl = h('datalist', { id: 'cats-' + doc.id }, cats.map(c => h('option', { value: c })));
    const sumTa = area(d.summary, v => { d.summary = v; }, { rows: 2, placeholder: '한 줄 요약 — 다른 곳에서 이 문서 링크 위에 마우스를 올리면 말풍선으로 보여요' });
    const imgs = h('div', { class: 'thumbs' }, d.images.map((id, i) => h('div', { class: 'tb' }, h('img', { src: imgURL(id), alt: '' }),
      h('button', { class: 'iconbtn', title: '빼기', onclick: rerenderDirty(() => d.images.splice(i, 1)) }, '✕'),
      i > 0 ? h('button', { class: 'iconbtn l', title: '앞으로', onclick: rerenderDirty(() => move(d.images, i, -1)) }, '‹') : null)),
      h('button', { class: 'btn sm', onclick: async () => { const fs = await pickFiles('image/*', true); for (const f of fs) d.images.push(await DB.addImageFile(f)); if (fs.length) { mark(); render(); } } }, '＋ 이미지'));
    return [
      dl,
      h('div', { class: 'view-head' }, h('b', {}, `${TYPE_LABEL[d.type]} 편집`), h('span', { class: 'sp' }),
        h('button', { class: 'btn sm', onclick: async () => {
          const n = await promptDlg('템플릿 이름', d.title + ' 형식'); if (!n) return;
          D.templates.push({ id: uid(), name: n, type: d.type, keys: d.infobox.map(r => r.k), sections: d.sections.map(s => ({ title: s.title, children: (s.children || []).map(c => c.title) })) });
          saveSoon(); toast('템플릿으로 저장했어요');
        } }, '템플릿으로 저장'),
        h('button', { class: 'btn sm', onclick: async () => { if (dirty && !await confirmDlg('저장하지 않은 변경을 버릴까요?', '버리기', true)) return; discarded = true; ctx.go({ v: 'doc', id: doc.id }); } }, '취소'),
        h('button', { class: 'btn sm primary', onclick: () => {
          if (inWorld('docs').some(o => o.id !== doc.id && o.title.trim() === d.title.trim())) toast('같은 이름의 문서가 이미 있어요. 링크가 헷갈릴 수 있어요.', 3500);
          commit(); ctx.go({ v: 'doc', id: doc.id });
        } }, '저장')),
      h('div', { class: 'card stack' },
        field('이름', inp(d.title, v => { d.title = v; }, { class: 'big' })),
        field('요약', h('div', { class: 'stack sm' }, toolsFor(sumTa, doc.id), sumTa)),
        h('div', { class: 'row2' },
          field('분류', inp(d.category, v => { d.category = v; }, { list: 'cats-' + doc.id, placeholder: '예: 주인공 / 조직 / 마법' })),
          field('태그 (쉼표로 구분)', inp(d.tags.join(', '), v => { d.tags = v.split(',').map(x => x.trim()).filter(Boolean); }, { placeholder: '예: 주연, 1부' })))),
      h('div', { class: 'card stack' }, h('h3', {}, '정보 상자'), h('div', { class: 'muted sm' }, '문서 오른쪽에 표로 보이는 정보예요. 이미지는 여러 장을 넣을 수 있어요.'), imgs,
        d.infobox.map((r, i) => h('div', { class: 'row' },
          inp(r.k, v => { r.k = v; }, { placeholder: '항목', class: 'narrow' }), inp(r.v, v => { r.v = v; }, { placeholder: '내용 ([[문서]] 링크 가능)', class: 'grow' }),
          h('button', { class: 'iconbtn', onclick: rerenderDirty(() => move(d.infobox, i, -1)) }, '↑'), h('button', { class: 'iconbtn', onclick: rerenderDirty(() => move(d.infobox, i, 1)) }, '↓'),
          h('button', { class: 'iconbtn', onclick: rerenderDirty(() => d.infobox.splice(i, 1)) }, '✕'))),
        h('div', { class: 'row' }, h('button', { class: 'btn sm', onclick: rerenderDirty(() => d.infobox.push({ k: '', v: '' })) }, '＋ 항목'))),
      h('div', { class: 'stack' }, h('h3', {}, '목차와 본문'), d.sections.map((_, i) => sectionEditor(d.sections, i, true)),
        h('button', { class: 'btn', onclick: rerenderDirty(() => d.sections.push({ id: uid(), title: '', collapsed: false, blocks: [{ id: uid(), type: 'text', text: '' }], children: [] })) }, '＋ 목차 추가')),
    ];
  }
  render();
  return () => { if (dirty && !discarded) commit(); };
}
