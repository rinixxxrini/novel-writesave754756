// 아카이브: 타임라인 · 플롯 · 관계도/조직도 · 지도
import { h, s, uid, esc, sel, inp, area, field, toast, dialog, confirmDlg, promptDlg, menu, pickFiles, debounce, download, blobToDataURL, move, clamp } from './util.js';
import * as DB from './db.js';
import { D, inWorld, docById, saveSoon, imgURL, curWork } from './db.js';
import { plainMarkup } from './wiki.js';

// 공통: 항목 선택/추가/이름변경/삭제 머리줄
function shell(root, rt, ctx, cfg, extras) {
  const items = inWorld(cfg.key);
  const cur = items.find(x => x.id === rt.id) || items[0];
  const add = async () => {
    const n = await promptDlg(`새 ${cfg.label} 이름`, ''); if (!n) return;
    const it = cfg.make(n); D[cfg.key].push(it); saveSoon(); ctx.go({ v: rt.v, id: it.id });
  };
  root.append(h('div', { class: 'view-head' }, h('h2', {}, cfg.label),
    cur ? sel(items.map(i => [i.id, i.name]), cur.id, v => ctx.go({ v: rt.v, id: v }), { class: 'itemsel' }) : null,
    h('button', { class: 'btn sm', onclick: add }, '＋ 새로 만들기'),
    cur ? h('button', { class: 'btn sm', onclick: async () => { const n = await promptDlg('이름', cur.name); if (n) { cur.name = n; saveSoon(); ctx.rerender(); } } }, '이름 변경') : null,
    cur ? h('button', { class: 'btn sm danger', onclick: async () => { if (await confirmDlg(`'${cur.name}'을(를) 삭제할까요?`, '삭제', true)) { D[cfg.key] = D[cfg.key].filter(x => x !== cur); saveSoon(); ctx.go({ v: rt.v }); } } }, '삭제') : null,
    h('span', { class: 'sp' }), ...(extras && cur ? extras(cur) : [])));
  if (!cur) { root.append(h('div', { class: 'empty' }, h('p', {}, cfg.empty), h('button', { class: 'btn primary', onclick: add }, `첫 ${cfg.label} 만들기`))); return null; }
  return cur;
}
const charDocs = () => inWorld('docs').filter(d => d.type === 'character');
const checklist = (all, picked, label) => h('div', { class: 'checks' }, all.length ? all.map(x => h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: picked.includes(x.id), onchange: e => { if (e.target.checked) picked.push(x.id); else picked.splice(picked.indexOf(x.id), 1); } }), label(x))) : h('span', { class: 'muted' }, '선택할 항목이 없어요'));

// ================= 타임라인 =================
function eventDialog(tl, ev, opts, onDone, onDelete) {
  const e = ev ? structuredClone(ev) : { id: uid(), title: '', cat: '', chars: [], body: '' };
  const cats = [...new Set(tl.events.map(x => x.cat).filter(Boolean))];
  const label = opts.slotLabel !== undefined ? inp(opts.slotLabel, null, { placeholder: '예: 10년 전 / 1회차 / 3월 2일' }) : null;
  const dl = h('datalist', { id: 'tlcats' }, cats.map(c => h('option', { value: c })));
  const title = inp(e.title, v => { e.title = v; }, { placeholder: '사건 이름' });
  const body = dialog({
    title: ev ? '이벤트 수정' : '새 이벤트', wide: true,
    body: h('div', { class: 'stack' }, dl, label ? field('시간대', label) : null, field('사건', title),
      field('분류', inp(e.cat, v => { e.cat = v; }, { list: 'tlcats', placeholder: '예: 사건 / 만남 / 전투' })),
      field('등장 캐릭터', checklist(charDocs(), e.chars, c => c.title)),
      field('내용', area(e.body, v => { e.body = v; }, { rows: 4 }))),
    buttons: [
      ev && onDelete ? { label: '삭제', kind: 'danger', onClick: c => { c(); onDelete(); } } : null,
      { label: '취소' },
      { label: '저장', kind: 'primary', onClick: c => { if (!e.title.trim()) return toast('사건 이름을 적어 주세요'); c(); onDone(e, label ? label.value.trim() : undefined); } }].filter(Boolean),
  });
  setTimeout(() => (label || title).focus(), 30);
  return body;
}

export function timeline(root, rt, ctx) {
  const tl = shell(root, rt, ctx, { key: 'timelines', label: '타임라인', empty: '사건을 시간 순서대로 정리해 보세요.', make: n => ({ id: uid(), worldId: D.cur.world, name: n, orient: 'v', slots: [], events: [] }) });
  if (!tl) return;
  rt.f ||= { q: '', cat: '', char: '' }; rt.view ||= 'basic';
  const f = rt.f, box = h('div', { class: 'tl-box' });
  const done = () => { saveSoon(); ctx.changed(); ctx.rerender(); };
  const slotsOrdered = () => (rt.rev ? [...tl.slots].reverse() : tl.slots);
  const cats = [...new Set(tl.events.map(e => e.cat).filter(Boolean))];
  const used = [...new Set(tl.events.flatMap(e => e.chars))].map(docById).filter(Boolean);
  const vis = ev => (!f.cat || ev.cat === f.cat) && (!f.char || ev.chars.includes(f.char)) && (!f.q || (ev.title + ev.body + ev.cat).toLowerCase().includes(f.q.toLowerCase()));

  const addEv = (sl, same) => eventDialog(tl, null, same ? {} : { slotLabel: '' }, (e, label) => {
    if (same) { e.slot = sl.id; }
    else {
      const ns = { id: uid(), label: label || '' }; const i = sl ? tl.slots.indexOf(sl) : tl.slots.length - 1;
      tl.slots.splice(rt.rev && sl ? i : i + 1, 0, ns); e.slot = ns.id;
    }
    tl.events.push(e); done();
  });
  const editEv = ev => { const sl = tl.slots.find(x => x.id === ev.slot); eventDialog(tl, ev, { slotLabel: sl ? sl.label : '' }, (e, label) => { Object.assign(ev, e); if (sl && label !== undefined) sl.label = label; done(); }, () => { tl.events = tl.events.filter(x => x !== ev); tl.slots = tl.slots.filter(x => tl.events.some(e => e.slot === x.id)); done(); }); };

  const evCard = ev => h('div', { class: 'tl-ev', onclick: () => editEv(ev) },
    h('div', { class: 'row' }, h('b', {}, ev.title), ev.cat ? h('span', { class: 'badge' }, ev.cat) : null),
    ev.chars.length ? h('div', { class: 'chips sm' }, ev.chars.map(id => { const d = docById(id); return d ? h('span', { class: 'chip', onclick: e => { e.stopPropagation(); ctx.beside({ v: 'doc', id }); } }, d.title) : null; })) : null,
    ev.body ? h('p', { class: 'muted clamp' }, ev.body) : null);

  const draw = () => {
    const filtering = f.cat || f.char || f.q;
    if (rt.view !== 'basic') {
      const slots = slotsOrdered();
      let rows, match;
      if (rt.view === 'cat') { rows = [...cats.map(c => ({ key: c, label: c })), { key: '', label: '(미분류)' }]; match = (e, k) => (e.cat || '') === k; }
      else { rows = used.map(d => ({ key: d.id, label: d.title })); match = (e, k) => e.chars.includes(k); }
      if (!slots.length || !rows.length) return box.replaceChildren(h('div', { class: 'empty' }, '표로 볼 이벤트가 아직 없어요'));
      return box.replaceChildren(h('div', { class: 'tablewrap' }, h('table', { class: 'tbl matrix' },
        h('thead', {}, h('tr', {}, h('th', {}, rt.view === 'cat' ? '분류' : '캐릭터'), slots.map(sl => h('th', {}, sl.label || '(미정)')))),
        h('tbody', {}, rows.map(r => h('tr', {}, h('th', {}, r.label), slots.map(sl => h('td', {}, tl.events.filter(e => e.slot === sl.id && match(e, r.key) && vis(e)).map(e => h('button', { class: 'chip link', onclick: () => editEv(e) }, e.title))))))))));
    }
    const els = slotsOrdered().map(sl => {
      const shown = tl.events.filter(e => e.slot === sl.id && vis(e));
      if (filtering && !shown.length) return null;
      const mv = d => { const i = tl.slots.indexOf(sl); if (move(tl.slots, i, rt.rev ? -d : d)) done(); };
      return h('div', { class: 'tl-slot' },
        h('div', { class: 'tl-time' }, h('span', { class: 'dot' }), h('button', { class: 'tl-label', title: '시간대 이름 바꾸기', onclick: async () => { const v = await promptDlg('시간대 이름', sl.label); if (v != null) { sl.label = v; done(); } } }, sl.label || '(시간 미정)'),
          h('button', { class: 'iconbtn', title: '위로', onclick: () => mv(-1) }, rt.orient === 'h' ? '←' : '↑'), h('button', { class: 'iconbtn', title: '아래로', onclick: () => mv(1) }, rt.orient === 'h' ? '→' : '↓'),
          h('button', { class: 'iconbtn', title: '이 시간대 삭제', onclick: async () => { if (await confirmDlg('이 시간대와 안의 이벤트를 모두 삭제할까요?', '삭제', true)) { tl.events = tl.events.filter(e => e.slot !== sl.id); tl.slots = tl.slots.filter(x => x !== sl); done(); } } }, '🗑')),
        h('div', { class: 'tl-events' }, shown.map(evCard)),
        h('div', { class: 'tl-add' }, h('button', { class: 'btn sm ghost', onclick: () => addEv(sl, true) }, '＋ 같은 시간대'), h('button', { class: 'btn sm ghost', onclick: () => addEv(sl, false) }, '＋ 다음 시간대')));
    }).filter(Boolean);
    box.replaceChildren(h('div', { class: 'tl ' + (tl.orient === 'h' ? 'h' : 'v') }, ...(els.length ? els : [h('div', { class: 'empty' }, tl.slots.length ? '조건에 맞는 이벤트가 없어요' : '아직 이벤트가 없어요')])));
  };
  rt.orient = tl.orient;
  root.append(h('div', { class: 'toolbar' },
    sel([['v', '세로 축'], ['h', '가로 축']], tl.orient, v => { tl.orient = v; saveSoon(); rt.orient = v; draw(); }),
    sel([['', '오래된 것 먼저'], ['1', '최근 것 먼저']], rt.rev ? '1' : '', v => { rt.rev = !!v; draw(); }),
    sel([['basic', '기본 보기'], ['cat', '분류별 표'], ['char', '캐릭터별 표']], rt.view, v => { rt.view = v; draw(); }),
    sel([['', '전체 분류'], ...cats], f.cat, v => { f.cat = v; draw(); }), sel([['', '전체 캐릭터'], ...used.map(d => [d.id, d.title])], f.char, v => { f.char = v; draw(); }),
    inp(f.q, v => { f.q = v; draw(); }, { placeholder: '이벤트 검색', class: 'search' }), h('span', { class: 'sp' }),
    h('button', { class: 'btn primary sm', onclick: () => (tl.slots.length ? addEv(slotsOrdered().at(-1), false) : addEv(null, false)) }, '＋ 이벤트')), box);
  draw();
}

// ================= 플롯 =================
const P_KIND = ['복선', '사건', '떡밥', '전개', '설정', '기타'], P_STATUS = ['예정', '진행', '완료', '회수'];
export function plot(root, rt, ctx) {
  const pl = shell(root, rt, ctx, { key: 'plots', label: '플롯', empty: '복선·사건·전개를 카드로 모아 흐름을 정리해 보세요.', make: n => ({ id: uid(), worldId: D.cur.world, name: n, groups: [{ id: uid(), name: '기본' }], lanes: [{ id: uid(), name: '줄 1' }], cards: [], links: [] }) });
  if (!pl) return;
  rt.pv ||= 'folder';
  let linkFrom = null;
  const done = () => { saveSoon(); ctx.changed(); ctx.rerender(); };
  const cardDlg = (c0, defaults) => {
    const c = c0 ? structuredClone(c0) : { id: uid(), title: '', kind: '사건', status: '예정', body: '', group: pl.groups[0].id, lane: pl.lanes[0].id, docs: [], eps: [], ...defaults };
    const dlg = dialog({
      title: c0 ? '플롯 카드 수정' : '새 플롯 카드', wide: true,
      body: h('div', { class: 'stack' }, field('제목', inp(c.title, v => { c.title = v; })),
        h('div', { class: 'row2' }, field('종류', sel(P_KIND, c.kind, v => { c.kind = v; })), field('진행 상태', sel(P_STATUS, c.status, v => { c.status = v; }))),
        field('내용', area(c.body, v => { c.body = v; }, { rows: 4 })),
        h('div', { class: 'row2' }, field('폴더(그룹)', sel(pl.groups.map(g => [g.id, g.name]), c.group, v => { c.group = v; })), field('줄(흐름형)', sel(pl.lanes.map(g => [g.id, g.name]), c.lane, v => { c.lane = v; }))),
        field('관련 문서', checklist(inWorld('docs'), c.docs, d => d.title + (d.type === 'character' ? ' (캐릭터)' : ' (설정)'))),
        field('관련 회차', checklist(curWork().episodes, c.eps, e => e.title || '제목 없음'))),
      buttons: [c0 ? { label: '삭제', kind: 'danger', onClick: cl => { cl(); pl.cards = pl.cards.filter(x => x !== c0); pl.links = pl.links.filter(l => l.a !== c0.id && l.b !== c0.id); done(); } } : null, { label: '취소' },
        { label: '저장', kind: 'primary', onClick: cl => { if (!c.title.trim()) return toast('제목을 적어 주세요'); cl(); if (c0) Object.assign(c0, c); else pl.cards.push(c); done(); } }].filter(Boolean),
    });
    return dlg;
  };
  const moveCard = (c, d, by) => {
    const sib = pl.cards.filter(x => x[by] === c[by]); const t = sib[sib.indexOf(c) + d]; if (!t) return;
    const i = pl.cards.indexOf(c), j = pl.cards.indexOf(t); [pl.cards[i], pl.cards[j]] = [pl.cards[j], pl.cards[i]]; saveSoon(); ctx.rerender();
  };
  const cardEl = (c, by) => h('div', { class: 'pcard' + (linkFrom === c.id ? ' linking' : ''), data: { id: c.id }, onclick: () => {
    if (linkFrom) {
      if (linkFrom !== c.id) { const i = pl.links.findIndex(l => l.a === linkFrom && l.b === c.id); if (i >= 0) pl.links.splice(i, 1); else pl.links.push({ a: linkFrom, b: c.id }); }
      linkFrom = null; saveSoon(); ctx.rerender(); return;
    }
    cardDlg(c);
  } },
  h('div', { class: 'row' }, h('span', { class: 'badge k-' + P_KIND.indexOf(c.kind) }, c.kind), h('span', { class: 'badge s-' + P_STATUS.indexOf(c.status) }, c.status), h('span', { class: 'sp' }),
    rt.pv === 'flow' ? h('button', { class: 'iconbtn', title: '다른 카드와 선으로 연결', onclick: e => { e.stopPropagation(); linkFrom = c.id; toast('이어 줄 카드를 클릭하세요 (다시 클릭하면 연결 해제, Esc 취소)'); document.querySelectorAll('.pcard').forEach(x => x.classList.toggle('linking', x.dataset.id === c.id)); } }, '↪') : null,
    h('button', { class: 'iconbtn', onclick: e => { e.stopPropagation(); moveCard(c, -1, by); } }, '↑'), h('button', { class: 'iconbtn', onclick: e => { e.stopPropagation(); moveCard(c, 1, by); } }, '↓')),
  h('b', {}, c.title), c.body ? h('p', { class: 'muted clamp' }, c.body) : null,
  (c.docs.length || c.eps.length) ? h('div', { class: 'chips sm' },
    c.docs.map(id => { const d = docById(id); return d ? h('span', { class: 'chip', onclick: e => { e.stopPropagation(); ctx.beside({ v: 'doc', id }); } }, d.title) : null; }),
    c.eps.map(id => { const e2 = curWork().episodes.find(x => x.id === id); return e2 ? h('span', { class: 'chip ep', onclick: e => { e.stopPropagation(); ctx.beside({ v: 'ep', id }); } }, e2.title || '회차') : null; })) : null);

  const colHead = (arr, g, key, label) => h('div', { class: 'pcol-head' },
    h('b', { class: 'ptitle', title: '이름 바꾸기', onclick: async () => { const v = await promptDlg(label + ' 이름', g.name); if (v) { g.name = v; done(); } } }, g.name),
    h('small', { class: 'muted' }, pl.cards.filter(c => c[key] === g.id).length), h('span', { class: 'sp' }),
    h('button', { class: 'iconbtn', onclick: () => { if (move(arr, arr.indexOf(g), -1)) done(); } }, '←'), h('button', { class: 'iconbtn', onclick: () => { if (move(arr, arr.indexOf(g), 1)) done(); } }, '→'),
    h('button', { class: 'iconbtn', onclick: async () => {
      if (arr.length < 2) return toast('최소 하나는 남겨야 해요');
      if (!await confirmDlg(`'${g.name}'을(를) 삭제할까요? 안의 카드는 다른 ${label}으로 옮겨져요.`, '삭제', true)) return;
      const to = arr.find(x => x !== g).id; pl.cards.forEach(c => { if (c[key] === g.id) c[key] = to; }); arr.splice(arr.indexOf(g), 1); done();
    } }, '🗑'));

  let flowEl, svg, ro;
  const drawLinks = () => {
    if (!flowEl || !svg) return;
    svg.replaceChildren();
    svg.setAttribute('width', flowEl.scrollWidth); svg.setAttribute('height', flowEl.scrollHeight);
    svg.append(s('defs', {}, s('marker', { id: 'ah', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 11, markerHeight: 11, markerUnits: 'userSpaceOnUse', orient: 'auto-start-reverse' }, s('path', { d: 'M0 0L10 5L0 10z', fill: 'var(--ac)' }))));
    const fr = flowEl.getBoundingClientRect();
    for (const l of pl.links) {
      const A = flowEl.querySelector(`[data-id="${l.a}"]`), B = flowEl.querySelector(`[data-id="${l.b}"]`); if (!A || !B) continue;
      const a = A.getBoundingClientRect(), b = B.getBoundingClientRect();
      const ox = flowEl.scrollLeft - fr.left, oy = flowEl.scrollTop - fr.top;
      let sx, sy, ex, ey, d;
      if (b.top > a.bottom - 4) { sx = a.left + a.width / 2 + ox; sy = a.bottom + oy; ex = b.left + b.width / 2 + ox; ey = b.top + oy; const dy = Math.max(30, (ey - sy) / 2); d = `M${sx} ${sy}C${sx} ${sy + dy} ${ex} ${ey - dy} ${ex} ${ey}`; }
      else { const right = b.left > a.left; sx = (right ? a.right : a.left) + ox; sy = a.top + a.height / 2 + oy; ex = (right ? b.left : b.right) + ox; ey = b.top + b.height / 2 + oy; const dx = Math.max(40, Math.abs(ex - sx) / 2) * (right ? 1 : -1); d = `M${sx} ${sy}C${sx + dx} ${sy} ${ex - dx} ${ey} ${ex} ${ey}`; }
      svg.append(s('path', { d, fill: 'none', stroke: 'var(--ac)', 'stroke-width': 2, 'marker-end': 'url(#ah)', class: 'plink', onclick: async () => { if (await confirmDlg('이 연결선을 지울까요?', '지우기')) { pl.links = pl.links.filter(x => x !== l); saveSoon(); drawLinks(); } } }, s('title', {}, '클릭하면 연결 해제')));
    }
  };

  const folderView = () => h('div', { class: 'pboard' }, ...pl.groups.map(g => h('div', { class: 'pcol' }, colHead(pl.groups, g, 'group', '폴더'),
    pl.cards.filter(c => c.group === g.id).map(c => cardEl(c, 'group')), h('button', { class: 'btn sm ghost', onclick: () => cardDlg(null, { group: g.id }) }, '＋ 플롯'))),
  h('button', { class: 'btn sm', onclick: async () => { const n = await promptDlg('새 폴더 이름', ''); if (n) { pl.groups.push({ id: uid(), name: n }); done(); } } }, '＋ 폴더'));
  const flowView = () => {
    svg = s('svg', { class: 'plinks' });
    const board = h('div', { class: 'pboard flow' }, ...pl.lanes.map(g => h('div', { class: 'pcol' }, colHead(pl.lanes, g, 'lane', '줄'),
      pl.cards.filter(c => c.lane === g.id).map(c => cardEl(c, 'lane')), h('button', { class: 'btn sm ghost', onclick: () => cardDlg(null, { lane: g.id }) }, '＋ 플롯'))),
    h('button', { class: 'btn sm', onclick: async () => { const n = await promptDlg('새 줄 이름', ''); if (n) { pl.lanes.push({ id: uid(), name: n }); done(); } } }, '＋ 줄'));
    flowEl = h('div', { class: 'pflow' }, svg, board);
    requestAnimationFrame(drawLinks);
    ro = new ResizeObserver(() => drawLinks()); ro.observe(board);
    flowEl.addEventListener('scroll', () => { }, { passive: true });
    return flowEl;
  };
  const keyHandler = e => { if (e.key === 'Escape' && linkFrom) { linkFrom = null; ctx.rerender(); } };
  document.addEventListener('keydown', keyHandler);
  root.append(h('div', { class: 'toolbar' },
    h('div', { class: 'seg' }, h('button', { class: rt.pv === 'folder' ? 'on' : '', onclick: () => { rt.pv = 'folder'; ctx.rerender(); } }, '폴더형'), h('button', { class: rt.pv === 'flow' ? 'on' : '', onclick: () => { rt.pv = 'flow'; ctx.rerender(); } }, '흐름형')),
    h('span', { class: 'muted' }, rt.pv === 'flow' ? '카드의 ↪ 버튼으로 카드끼리 선을 이어 보세요' : '그룹별로 플롯을 모아 봐요'), h('span', { class: 'sp' }),
    h('button', { class: 'btn primary sm', onclick: () => cardDlg(null) }, '＋ 플롯 카드')), rt.pv === 'flow' ? flowView() : folderView());
  return () => { document.removeEventListener('keydown', keyHandler); ro && ro.disconnect(); };
}

// ================= 관계도 / 조직도 =================
const NODE_COLORS = ['#7c5cff', '#e5534b', '#2fa36b', '#d99a1c', '#2b8fd9', '#c24fa8', '#6b7280'];
async function exportSVG(svgEl, name, W, H) {
  const clone = svgEl.cloneNode(true);
  const cs = getComputedStyle(document.documentElement);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg'); clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink'); clone.setAttribute('width', W); clone.setAttribute('height', H);
  for (const im of clone.querySelectorAll('image')) { const u = im.getAttribute('href'); try { im.setAttribute('href', await blobToDataURL(await (await fetch(u)).blob())); } catch { im.remove(); } }
  clone.querySelectorAll('*').forEach(el => { for (const a of [...el.attributes]) if (a.value.includes('var(')) el.setAttribute(a.name, a.value.replace(/var\((--[\w-]+)\)/g, (m, v) => cs.getPropertyValue(v).trim())); });
  const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect'); bg.setAttribute('width', W); bg.setAttribute('height', H); bg.setAttribute('fill', cs.getPropertyValue('--bg2').trim() || '#17161d'); clone.insertBefore(bg, clone.firstChild);
  const img = new Image(); img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(clone));
  await img.decode();
  const c = document.createElement('canvas'); c.width = W * 2; c.height = H * 2; const g = c.getContext('2d'); g.scale(2, 2); g.drawImage(img, 0, 0, W, H);
  c.toBlob(b => download(b, name + '.png'));
}

export function graph(root, rt, ctx) {
  const W = 1000, H = 640, R = 34;
  const G = shell(root, rt, ctx, { key: 'graphs', label: '관계도', empty: '캐릭터를 올려놓고 선으로 이으면 관계도가 돼요. 단체·장소를 넣어 조직도로도 쓸 수 있어요.', make: n => ({ id: uid(), worldId: D.cur.world, name: n, mode: 'graph', nodes: [], edges: [] }) },
    g => [h('button', { class: 'btn sm', onclick: () => exportSVG(svg, g.name, W, H) }, 'PNG로 저장')]);
  if (!G) return;
  const g = G; const org = () => g.mode === 'org';
  let selected = null, linking = false, linkFrom = null, svg;
  const svgWrap = h('div', { class: 'gwrap' });
  const side = h('div', { class: 'gside stack' });
  const nodeLabel = n => (n.doc ? (docById(n.doc)?.title || '(삭제된 문서)') : n.label);
  const nodeById = id => g.nodes.find(n => n.id === id);
  const save = () => { saveSoon(); ctx.changed(); };

  const orgLayout = () => {
    const kids = new Map(g.nodes.map(n => [n.id, []])); const hasParent = new Set();
    g.edges.forEach(e => { if (kids.has(e.a) && kids.has(e.b)) { kids.get(e.a).push(e.b); hasParent.add(e.b); } });
    let leaf = 0; const seen = new Set();
    const place = (id, depth) => {
      if (seen.has(id)) return null; seen.add(id);
      const ch = kids.get(id).map(c => place(c, depth + 1)).filter(x => x != null);
      const n = nodeById(id); n.y = 60 + depth * 110;
      n.x = ch.length ? ch.reduce((a, c) => a + nodeById(c).x, 0) / ch.length : 80 + (leaf++) * 150;
      return id;
    };
    g.nodes.filter(n => !hasParent.has(n.id)).forEach(n => place(n.id, 0));
    g.nodes.filter(n => !seen.has(n.id)).forEach(n => place(n.id, 0));
    const maxX = Math.max(...g.nodes.map(n => n.x), 0);
    if (maxX > W - 80) { const k = (W - 160) / (maxX - 80); g.nodes.forEach(n => { n.x = 80 + (n.x - 80) * k; }); }
  };

  const edgeEls = new Map(), nodeEls = new Map();
  const layoutEdge = e => {
    const A = nodeById(e.a), B = nodeById(e.b), o = edgeEls.get(e.id); if (!A || !B || !o) return;
    if (org()) {
      const my = (A.y + B.y) / 2;
      o.line.setAttribute('d', `M${A.x} ${A.y + 22}V${my}H${B.x}V${B.y - 22}`);
    } else {
      const dx = B.x - A.x, dy = B.y - A.y, d = Math.hypot(dx, dy) || 1;
      o.line.setAttribute('d', `M${A.x + dx / d * R} ${A.y + dy / d * R}L${B.x - dx / d * R} ${B.y - dy / d * R}`);
      const mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2;
      o.text.setAttribute('x', mx); o.text.setAttribute('y', my + 4);
      const w = Math.max(18, (e.label || '').length * 12 + 12); o.bg.setAttribute('x', mx - w / 2); o.bg.setAttribute('y', my - 11); o.bg.setAttribute('width', w); o.bg.setAttribute('height', 22);
    }
  };
  const editEdge = e => {
    const lab = inp(e.label || '', null, { placeholder: '예: 연인, 라이벌, 스승' });
    dialog({ title: '관계 편집', body: field('관계 이름', lab), buttons: [{ label: '관계 삭제', kind: 'danger', onClick: c => { c(); g.edges = g.edges.filter(x => x !== e); save(); draw(); } }, { label: '취소' }, { label: '저장', kind: 'primary', onClick: c => { e.label = lab.value.trim(); c(); save(); draw(); } }] });
  };

  const draw = () => {
    if (org()) orgLayout();
    edgeEls.clear(); nodeEls.clear();
    svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'gsvg', preserveAspectRatio: 'xMidYMid meet' });
    const eLayer = s('g'), nLayer = s('g'); svg.append(eLayer, nLayer);
    for (const e of g.edges) {
      if (!nodeById(e.a) || !nodeById(e.b)) continue;
      const line = s('path', { fill: 'none', stroke: 'var(--mut)', 'stroke-width': 2 });
      const bg = s('rect', { rx: 6, fill: 'var(--bg3)', stroke: 'var(--line)', class: 'elabel', onclick: () => editEdge(e) });
      const text = s('text', { 'text-anchor': 'middle', 'font-size': 13, fill: 'var(--tx)', class: 'elabel', onclick: () => editEdge(e) }, e.label || '');
      const grp = org() ? s('g', {}, line) : s('g', {}, line, (e.label ? bg : null), (e.label ? text : null));
      if (org()) { line.style.cursor = 'pointer'; line.addEventListener('click', async () => { if (await confirmDlg('이 연결을 지울까요?', '지우기')) { g.edges = g.edges.filter(x => x !== e); save(); draw(); } }); }
      else if (!e.label) { line.style.cursor = 'pointer'; line.addEventListener('click', () => editEdge(e)); }
      edgeEls.set(e.id, { line, bg, text }); eLayer.append(grp); layoutEdge(e);
    }
    for (const n of g.nodes) {
      const doc = n.doc ? docById(n.doc) : null; const img = doc?.images?.[0];
      const sel0 = selected === n.id, lk = linkFrom === n.id;
      const grp = s('g', { class: 'gnode' + (sel0 ? ' sel' : '') + (lk ? ' lk' : ''), transform: `translate(${n.x},${n.y})` });
      if (org()) {
        grp.append(s('rect', { x: -65, y: -22, width: 130, height: 44, rx: 8, fill: n.color || '#7c5cff', stroke: sel0 || lk ? 'var(--ac)' : 'none', 'stroke-width': 3 }),
          s('text', { 'text-anchor': 'middle', y: 5, 'font-size': 14, 'font-weight': 600, fill: '#fff' }, nodeLabel(n).slice(0, 12)));
      } else {
        const cid = 'cp' + n.id;
        grp.append(s('circle', { r: R, fill: n.color || '#7c5cff', stroke: sel0 || lk ? 'var(--ac)' : 'var(--line)', 'stroke-width': sel0 || lk ? 4 : 2 }));
        if (img) grp.append(s('clipPath', { id: cid }, s('circle', { r: R - 2 })), s('image', { href: imgURL(img), x: -R, y: -R, width: R * 2, height: R * 2, 'clip-path': `url(#${cid})`, preserveAspectRatio: 'xMidYMid slice' }));
        else grp.append(s('text', { 'text-anchor': 'middle', y: 7, 'font-size': 22, 'font-weight': 700, fill: '#fff' }, [...nodeLabel(n)][0] || '?'));
        grp.append(s('text', { 'text-anchor': 'middle', y: R + 18, 'font-size': 14, fill: 'var(--tx)', 'font-weight': 600 }, nodeLabel(n)));
      }
      // 드래그 / 클릭
      let drag = null;
      grp.addEventListener('pointerdown', ev => {
        ev.preventDefault(); grp.setPointerCapture(ev.pointerId);
        const pt = svg.createSVGPoint(); pt.x = ev.clientX; pt.y = ev.clientY; const p = pt.matrixTransform(svg.getScreenCTM().inverse());
        drag = { dx: p.x - n.x, dy: p.y - n.y, moved: false, sx: ev.clientX, sy: ev.clientY };
      });
      grp.addEventListener('pointermove', ev => {
        if (!drag) return;
        if (Math.hypot(ev.clientX - drag.sx, ev.clientY - drag.sy) > 4) drag.moved = true;
        if (!drag.moved || org()) return;
        const pt = svg.createSVGPoint(); pt.x = ev.clientX; pt.y = ev.clientY; const p = pt.matrixTransform(svg.getScreenCTM().inverse());
        n.x = clamp(p.x - drag.dx, R, W - R); n.y = clamp(p.y - drag.dy, R, H - R - 20);
        grp.setAttribute('transform', `translate(${n.x},${n.y})`);
        g.edges.forEach(e => { if (e.a === n.id || e.b === n.id) layoutEdge(e); });
      });
      grp.addEventListener('pointerup', async () => {
        if (!drag) return; const moved = drag.moved; drag = null;
        if (moved) return save();
        if (linking) {
          if (!linkFrom) { linkFrom = n.id; draw(); drawSide(); return; }
          if (linkFrom !== n.id) {
            const from = linkFrom; linking = false; linkFrom = null; let label = '';
            if (!org()) { const v = await promptDlg('두 사람의 관계는? (비워도 돼요)', '', { title: '관계 이름' }); if (v === null) { draw(); drawSide(); return; } label = v; }
            if (!g.edges.some(e => e.a === from && e.b === n.id)) g.edges.push({ id: uid(), a: from, b: n.id, label });
            save();
          } else { linking = false; linkFrom = null; }
          draw(); drawSide(); return;
        }
        selected = selected === n.id ? null : n.id; draw(); drawSide();
      });
      nodeEls.set(n.id, grp); nLayer.append(grp);
    }
    svgWrap.replaceChildren(svg);
  };

  const drawSide = () => {
    const inGraph = new Set(g.nodes.map(n => n.doc).filter(Boolean));
    let pickType = rt.gtype || 'character';
    const avail = inWorld('docs').filter(d => d.type === pickType && !inGraph.has(d.id));
    const place = () => { const i = g.nodes.length; return org() ? { x: 80 + (i % 6) * 150, y: 70 + Math.floor(i / 6) * 110 } : { x: 130 + (i % 6) * 150, y: 110 + Math.floor(i / 6) * 130 + (i % 2) * 30 }; };
    const sn = selected ? nodeById(selected) : null;
    side.replaceChildren(...[
      h('div', { class: 'seg' }, h('button', { class: !org() ? 'on' : '', onclick: () => { g.mode = 'graph'; save(); draw(); drawSide(); } }, '관계도'), h('button', { class: org() ? 'on' : '', onclick: () => { g.mode = 'org'; save(); draw(); drawSide(); } }, '조직도')),
      h('div', { class: 'row' }, h('button', { class: 'btn sm' + (linking ? ' primary' : ''), onclick: () => { if (g.nodes.length < 2) return toast('노드가 2개 이상 있어야 이을 수 있어요'); linking = !linking; linkFrom = null; draw(); drawSide(); } }, linking ? '연결 취소' : (org() ? '＋ 상하 연결(위→아래)' : '＋ 관계 연결')),
        h('button', { class: 'btn sm', onclick: async () => { const n = await promptDlg('이름 (단체·장소 등)', ''); if (!n) return; g.nodes.push({ id: uid(), label: n, color: NODE_COLORS[5], ...place() }); save(); draw(); drawSide(); } }, '＋ 직접 추가')),
      linking ? h('small', { class: 'muted' }, (linkFrom ? '이제 끝 노드를 클릭하세요.' : (org() ? '위쪽(상위) 노드를 먼저 클릭하세요.' : '시작 노드를 먼저 클릭하세요.'))) : null,
      sn ? h('div', { class: 'card stack sm' }, h('b', {}, nodeLabel(sn)),
        h('div', { class: 'chips' }, NODE_COLORS.map(c => h('button', { class: 'cdot' + (sn.color === c ? ' on' : ''), style: { background: c }, onclick: () => { sn.color = c; save(); draw(); drawSide(); } }))),
        h('div', { class: 'row wrap' },
          sn.doc ? h('button', { class: 'btn sm', onclick: () => ctx.beside({ v: 'doc', id: sn.doc }) }, '문서 열기') : h('button', { class: 'btn sm', onclick: async () => { const v = await promptDlg('이름 변경', sn.label); if (v) { sn.label = v; save(); draw(); drawSide(); } } }, '이름 변경'),
          h('button', { class: 'btn sm danger', onclick: () => { g.nodes = g.nodes.filter(n => n !== sn); g.edges = g.edges.filter(e => e.a !== sn.id && e.b !== sn.id); selected = null; save(); draw(); drawSide(); } }, '노드 삭제'))) : null,
      h('div', { class: 'card stack sm' }, h('div', { class: 'row' }, h('b', {}, '문서에서 추가'), h('span', { class: 'sp' }), sel([['character', '캐릭터'], ['setting', '작품설정']], pickType, v => { rt.gtype = v; drawSide(); })),
        avail.length ? h('div', { class: 'pick-list sm' }, avail.map(d => h('button', { class: 'pick-item', onclick: () => { g.nodes.push({ id: uid(), doc: d.id, color: NODE_COLORS[g.nodes.length % 5], ...place() }); save(); draw(); drawSide(); } }, h('b', {}, d.title)))) : h('small', { class: 'muted' }, '추가할 문서가 없어요')),
      g.edges.length ? h('div', { class: 'card stack sm' }, h('b', {}, `연결 ${g.edges.length}개`), g.edges.map(e => h('button', { class: 'listrow', onclick: () => editEdge(e) }, `${nodeLabel(nodeById(e.a) || {})} ${org() ? '→' : '—'} ${nodeLabel(nodeById(e.b) || {})}`, h('small', { class: 'muted' }, e.label || '')))) : null].filter(Boolean));
  };
  root.append(h('div', { class: 'gmain' }, svgWrap, side));
  draw(); drawSide();
}

// ================= 지도 =================
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function noiser(seed) {
  const r = rng(seed), P = new Float32Array(1024); for (let i = 0; i < 1024; i++) P[i] = r();
  const hash = (x, y) => P[((x * 73856093) ^ (y * 19349663)) & 1023], sm = t => t * t * (3 - 2 * t);
  const n = (x, y) => { const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1), u = sm(xf), v = sm(yf); return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v; };
  return (x, y, oct = 5) => { let sum = 0, amp = .5, f = 1, norm = 0; for (let i = 0; i < oct; i++) { sum += amp * n(x * f, y * f); norm += amp; amp *= .5; f *= 2.03; } return sum / norm; };
}
const SEA = 0.2;
const MOODS = {
  temperate: { label: '푸른 대륙', stops: [[-0.6, [8, 24, 60]], [0.0, [16, 52, 110]], [0.17, [52, 120, 178]], [0.2, [214, 204, 150]], [0.25, [124, 168, 86]], [0.45, [64, 124, 62]], [0.62, [112, 104, 80]], [0.82, [190, 188, 184]], [1.1, [250, 250, 252]]] },
  volcanic: { label: '화산 대륙', stops: [[-0.6, [14, 10, 16]], [0.0, [38, 16, 22]], [0.17, [90, 30, 26]], [0.2, [70, 62, 60]], [0.3, [58, 50, 50]], [0.5, [92, 66, 52]], [0.7, [168, 70, 32]], [0.9, [240, 130, 40]], [1.1, [255, 220, 120]]] },
  snow: { label: '설원', stops: [[-0.6, [14, 36, 70]], [0.0, [30, 70, 120]], [0.17, [98, 156, 200]], [0.2, [220, 232, 240]], [0.3, [236, 244, 250]], [0.5, [200, 218, 232]], [0.7, [150, 170, 190]], [1.1, [255, 255, 255]]] },
  desert: { label: '사막', stops: [[-0.6, [10, 60, 90]], [0.0, [20, 110, 140]], [0.17, [70, 180, 190]], [0.2, [238, 222, 170]], [0.3, [226, 190, 120]], [0.5, [200, 150, 90]], [0.7, [156, 108, 70]], [1.1, [236, 226, 210]]] },
};
const lerpC = (stops, e) => {
  if (e <= stops[0][0]) return stops[0][1]; for (let i = 1; i < stops.length; i++) if (e <= stops[i][0]) { const [e0, c0] = stops[i - 1], [e1, c1] = stops[i], t = (e - e0) / (e1 - e0); return [c0[0] + (c1[0] - c0[0]) * t, c0[1] + (c1[1] - c0[1]) * t, c0[2] + (c1[2] - c0[2]) * t]; } return stops.at(-1)[1];
};
export function drawMap(canvas, m) {
  const W = canvas.width, Hh = canvas.height, N = noiser(m.seed), Rr = rng(m.seed + 7), asp = W / Hh;
  const cs = []; for (let i = 0; i < m.continents; i++) cs.push({ x: 0.14 + 0.72 * Rr(), y: 0.2 + 0.6 * Rr(), r: (0.13 + 0.1 * Rr()) * (0.6 + m.size * 1.25) });
  const el = new Float32Array(W * Hh), stops = (MOODS[m.mood] || MOODS.temperate).stops;
  for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) {
    const u = x / W, v = y / Hh;
    const wx = u + (N(u * 3 + 11, v * 3 + 5, 3) - .5) * .26, wy = v + (N(u * 3 + 31, v * 3 + 17, 3) - .5) * .26;
    let mk = -0.5; for (const c of cs) { const d = Math.hypot((wx - c.x) * asp, wy - c.y) / c.r; mk = Math.max(mk, (1 - d) * 1.25); }
    const edge = Math.min(1, Math.min(u, 1 - u, v, 1 - v) * 5);
    el[y * W + x] = mk * 0.9 + (N(u * 7, v * 7, 5) - .5) * 0.75 - (1 - edge) * 0.55;
  }
  const ctx = canvas.getContext('2d'), img = ctx.createImageData(W, Hh);
  for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, e = el[i]; let [r, g, b] = lerpC(stops, e > SEA ? SEA + (e - SEA) * 0.62 : e);
    if (e > SEA) {
      const nw = el[Math.max(0, y - 1) * W + Math.max(0, x - 1)], se = el[Math.min(Hh - 1, y + 1) * W + Math.min(W - 1, x + 1)];
      const sh = 1 + (se - nw) * 5.5; r *= sh; g *= sh; b *= sh;
    } else if (e > SEA - 0.035) { const t = (e - (SEA - 0.035)) / 0.035; r += 40 * t; g += 40 * t; b += 30 * t; }
    const p = i * 4; img.data[p] = clamp(r, 0, 255); img.data[p + 1] = clamp(g, 0, 255); img.data[p + 2] = clamp(b, 0, 255); img.data[p + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}
const PIN_ICONS = [['🏰', '성·왕국'], ['🏙', '도시'], ['🏘', '마을'], ['⛰', '산'], ['🌲', '숲'], ['🏝', '섬'], ['⚓', '항구'], ['🕳', '동굴·던전'], ['⛩', '신전'], ['⭐', '기타']];

export function map(root, rt, ctx) {
  const M = shell(root, rt, ctx, { key: 'maps', label: '지도', empty: '대륙을 만들고 도시·마을 핀을 찍어 세계 지도를 완성해 보세요.', make: n => ({ id: uid(), worldId: D.cur.world, name: n, seed: Math.floor(Math.random() * 1e6), continents: 3, size: 0.75, mood: 'temperate', pins: [] }) },
    m => [h('button', { class: 'btn sm', onclick: () => exportMap(m) }, 'PNG로 저장')]);
  if (!M) return;
  const m = M, W = 960, Hh = 600;
  const canvas = h('canvas', { width: W, height: Hh, class: 'mapcanvas' });
  const layer = h('div', { class: 'pinlayer' });
  const box = h('div', { class: 'mapbox' }, canvas, layer);
  let adding = false;
  const regen = debounce(() => { drawMap(canvas, m); }, 90);
  const save = () => { saveSoon(); ctx.changed(); };

  const pinDlg = (p0, pos) => {
    const p = p0 ? structuredClone(p0) : { id: uid(), x: pos ? pos.x : 0.5, y: pos ? pos.y : 0.5, name: '', icon: '🏰', note: '', img: '', doc: '' };
    const docs = inWorld('docs');
    const preview = h('div', { class: 'pinimg' }, p.img ? h('img', { src: imgURL(p.img), alt: '' }) : null);
    const dlg = dialog({ title: p0 ? '핀 편집' : '새 핀', wide: true,
      body: h('div', { class: 'stack' }, h('div', { class: 'row2' }, field('이름', inp(p.name, v => { p.name = v; }, { placeholder: '예: 엘루나 왕국' })), field('아이콘', sel(PIN_ICONS.map(([i, l]) => [i, `${i} ${l}`]), p.icon, v => { p.icon = v; }))),
        field('설명', area(p.note, v => { p.note = v; }, { rows: 3 })), field('연결할 설정 문서', sel([['', '(없음)'], ...docs.map(d => [d.id, d.title])], p.doc, v => { p.doc = v; })),
        field('작은 이미지', h('div', { class: 'stack sm' }, preview, h('div', { class: 'row' }, h('button', { class: 'btn sm', onclick: async () => { const [f] = await pickFiles('image/*'); if (!f) return; p.img = await DB.addImageFile(f); preview.replaceChildren(h('img', { src: imgURL(p.img), alt: '' })); } }, '이미지 선택'), p.img ? h('button', { class: 'btn sm', onclick: () => { p.img = ''; preview.replaceChildren(); } }, '이미지 빼기') : null)))),
      buttons: [p0 ? { label: '삭제', kind: 'danger', onClick: c => { c(); m.pins = m.pins.filter(x => x !== p0); save(); drawPins(); } } : null, p0 && p0.doc ? { label: '문서 열기', onClick: () => { dlg.close(); ctx.beside({ v: 'doc', id: p0.doc }); } } : null, { label: '취소' },
        { label: '저장', kind: 'primary', onClick: c => { if (!p.name.trim()) return toast('이름을 적어 주세요'); c(); if (p0) Object.assign(p0, p); else m.pins.push(p); save(); drawPins(); } }].filter(Boolean) });
  };
  function drawPins() {
    layer.replaceChildren(...m.pins.map(p => {
      const el = h('div', { class: 'pin', style: { left: p.x * 100 + '%', top: p.y * 100 + '%' }, title: p.note || p.name }, h('span', { class: 'pi' }, p.icon), h('span', { class: 'pl' }, p.name));
      let drag = null;
      el.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); el.setPointerCapture(e.pointerId); drag = { moved: false, sx: e.clientX, sy: e.clientY }; });
      el.addEventListener('pointermove', e => {
        if (!drag) return; if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 4) drag.moved = true; if (!drag.moved) return;
        const r = box.getBoundingClientRect(); p.x = clamp((e.clientX - r.left) / r.width, 0, 1); p.y = clamp((e.clientY - r.top) / r.height, 0, 1);
        el.style.left = p.x * 100 + '%'; el.style.top = p.y * 100 + '%';
      });
      el.addEventListener('pointerup', () => { if (!drag) return; const mv = drag.moved; drag = null; mv ? save() : pinDlg(p); });
      return el;
    }));
  }
  box.addEventListener('click', e => {
    if (!adding) return; const r = box.getBoundingClientRect();
    adding = false; box.classList.remove('adding'); addBtn.classList.remove('primary');
    pinDlg(null, { x: clamp((e.clientX - r.left) / r.width, 0, 1), y: clamp((e.clientY - r.top) / r.height, 0, 1) });
  });

  const addBtn = h('button', { class: 'btn sm', onclick: () => { adding = !adding; box.classList.toggle('adding', adding); addBtn.classList.toggle('primary', adding); if (adding) toast('지도를 클릭해 핀을 놓으세요'); } }, '📍 핀 추가');
  const seedIn = h('input', { type: 'number', value: m.seed, class: 'narrow', onchange: e => { m.seed = +e.target.value || 1; save(); drawMap(canvas, m); } });
  root.append(h('div', { class: 'toolbar' },
    h('button', { class: 'btn sm', onclick: () => { m.seed = Math.floor(Math.random() * 1e6); seedIn.value = m.seed; save(); drawMap(canvas, m); } }, '🎲 새로 생성'),
    h('label', { class: 'inl' }, '대륙 수 ', h('input', { type: 'range', min: 1, max: 6, step: 1, value: m.continents, oninput: e => { m.continents = +e.target.value; saveSoon(); regen(); } })),
    h('label', { class: 'inl' }, '크기 ', h('input', { type: 'range', min: 0.3, max: 1.2, step: 0.05, value: m.size, oninput: e => { m.size = +e.target.value; saveSoon(); regen(); } })),
    sel(Object.entries(MOODS).map(([k, v]) => [k, v.label]), m.mood, v => { m.mood = v; save(); drawMap(canvas, m); }),
    h('label', { class: 'inl' }, '시드 ', seedIn), h('span', { class: 'sp' }), addBtn), box,
  h('small', { class: 'muted' }, '핀은 끌어서 옮길 수 있어요. 같은 시드와 설정이면 항상 같은 지도가 나와요.'));
  drawMap(canvas, m); drawPins();

  async function exportMap(mm) {
    const c = document.createElement('canvas'); c.width = W; c.height = Hh; const g = c.getContext('2d'); g.drawImage(canvas, 0, 0);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const p of mm.pins) {
      const x = p.x * W, y = p.y * Hh; g.font = '28px serif'; g.fillText(p.icon, x, y - 8);
      g.font = 'bold 14px sans-serif'; g.lineWidth = 4; g.strokeStyle = 'rgba(0,0,0,.75)'; g.strokeText(p.name, x, y + 16); g.fillStyle = '#fff'; g.fillText(p.name, x, y + 16);
    }
    c.toBlob(b => download(b, mm.name + '.png'));
  }
}
