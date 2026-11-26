// 앱 셸: 사이드바, 분할 화면(최대 3개), 전역 검색, 부팅
import { $, h, toast, menu, confirmDlg, promptDlg, dialog, sel, esc, debounce, plainFromHTML } from './util.js';
import * as DB from './db.js';
import { D, curWork, curWorld, worksOf, saveSoon } from './db.js';
import * as wiki from './wiki.js';
import * as novel from './novel.js';
import * as arch from './archive.js';
import * as misc from './misc.js';

const VIEW = {
  overview: misc.overview, novel: novel.list, ep: novel.editor, docs: wiki.list, doc: wiki.doc,
  timeline: arch.timeline, plot: arch.plot, graph: arch.graph, map: arch.map,
  stats: misc.stats, memo: misc.memo, subs: misc.subs, settings: misc.settings,
};
const NAV = [
  ['overview', '작품 개요', { v: 'overview' }, '🏠'], ['novel', '소설', { v: 'novel' }, '✍'],
  ['docs:character', '캐릭터', { v: 'docs', t: 'character' }, '👤'], ['docs:setting', '작품설정', { v: 'docs', t: 'setting' }, '📚'],
  ['timeline', '타임라인', { v: 'timeline' }, '⏳'], ['plot', '플롯', { v: 'plot' }, '🧩'], ['graph', '관계도', { v: 'graph' }, '🕸'], ['map', '지도', { v: 'map' }, '🗺'],
  ['stats', '캐릭터 통계', { v: 'stats' }, '📊'], ['memo', '메모 보관함', { v: 'memo' }, '🗒'],
  ['subs', '투고 관리', { v: 'subs' }, '📮'], ['settings', '설정', { v: 'settings' }, '⚙'],
];
const ui = { panes: [{ v: 'overview' }], active: 0, collapsed: false };
let wrap, sideEl;
const cleanups = [];
const isMobile = () => innerWidth < 860;

function loadUI() {
  try {
    const u = JSON.parse(localStorage.getItem('lore-ui') || 'null');
    if (u && Array.isArray(u.panes) && u.panes.length && u.panes.every(p => VIEW[p.v])) { ui.panes = u.panes.slice(0, 3); ui.active = Math.min(u.active || 0, ui.panes.length - 1); ui.collapsed = !!u.collapsed; }
  } catch { /* 무시 */ }
}
const saveUI = () => { try { localStorage.setItem('lore-ui', JSON.stringify(ui)); } catch { /* 무시 */ } };

function navKey(rt) {
  if (rt.v === 'ep') return 'novel';
  if (rt.v === 'doc') { const d = DB.docById(rt.id); return 'docs:' + (d ? d.type : 'character'); }
  if (rt.v === 'docs') return 'docs:' + (rt.t || 'character');
  return rt.v;
}

// ---------- 패널 ----------
function ctxFor(i) {
  return {
    i,
    go: rt => go(i, rt),
    beside: rt => beside(i, rt),
    changed: () => changedDeb(i),
    refresh: () => { renderSide(); },
    rerender: () => go(i, { ...ui.panes[i] }),
  };
}

function buildPane(i) {
  const rt = ui.panes[i];
  const body = h('div', { class: 'pane-body' });
  const head = h('div', { class: 'pane-head' },
    sel(NAV.map(n => [n[0], n[3] + ' ' + n[1]]), navKey(rt), v => { const n = NAV.find(x => x[0] === v); go(i, { ...n[2] }); }),
    h('span', { class: 'sp' }),
    ui.panes.length > 1 ? h('button', { class: 'iconbtn', title: '이 화면 닫기', onclick: () => closePane(i) }, '✕') : null);
  const pane = h('section', { class: 'pane' + (i === ui.active ? ' active' : ''), onmousedown: () => { if (ui.active !== i) { ui.active = i; markActive(); renderSideActive(); saveUI(); } } }, head, body);
  try {
    cleanups[i] = VIEW[rt.v](body, rt, ctxFor(i)) || null;
  } catch (e) {
    console.error(e); cleanups[i] = null;
    body.append(h('div', { class: 'empty' }, h('p', {}, '화면을 그리는 중 문제가 생겼어요.'), h('pre', { class: 'err' }, String(e && e.stack || e)), h('button', { class: 'btn', onclick: () => go(i, { v: 'overview' }) }, '작품 개요로')));
  }
  return pane;
}
function runCleanup(i) { try { typeof cleanups[i] === 'function' && cleanups[i](); } catch (e) { console.error(e); } cleanups[i] = null; }
function renderPanes() {
  ui.panes.forEach((_, i) => runCleanup(i));
  wrap.innerHTML = ''; wrap.dataset.n = ui.panes.length;
  ui.panes.forEach((_, i) => wrap.append(buildPane(i)));
  saveUI();
}
function markActive() { [...wrap.children].forEach((p, i) => p.classList.toggle('active', i === ui.active)); }
function go(i, rt) {
  runCleanup(i); ui.panes[i] = rt; ui.active = i;
  const old = wrap.children[i]; const np = buildPane(i);
  old ? old.replaceWith(np) : wrap.append(np);
  markActive(); saveUI(); renderSideActive();
}
function reRenderPane(j) {
  const el = wrap.children[j]; if (!el) return;
  const top = el.querySelector('.pane-body')?.scrollTop || 0;
  runCleanup(j); const np = buildPane(j); el.replaceWith(np);
  const b = np.querySelector('.pane-body'); if (b) b.scrollTop = top;
}
const changedDeb = debounce(src => {
  ui.panes.forEach((_, j) => {
    if (j === src) return;
    const el = wrap.children[j], a = document.activeElement;
    if (el && a && el.contains(a) && (/INPUT|TEXTAREA|SELECT/.test(a.tagName) || a.isContentEditable)) return;
    reRenderPane(j);
  });
}, 600);
function closePane(i) {
  ui.panes.forEach((_, k) => runCleanup(k));
  ui.panes.splice(i, 1); ui.active = Math.min(ui.active, ui.panes.length - 1); renderPanes(); renderSideActive();
}
function addPane() {
  if (isMobile()) return toast('화면 분할은 넓은 화면에서 쓸 수 있어요');
  if (ui.panes.length >= 3) return toast('화면은 최대 3개까지 나눌 수 있어요');
  ui.panes.forEach((_, k) => runCleanup(k));
  ui.panes.push({ v: 'docs', t: 'character' }); ui.active = ui.panes.length - 1; renderPanes(); renderSideActive();
}
function beside(i, rt) {
  if (isMobile()) return go(i, rt);
  ui.panes.forEach((_, k) => runCleanup(k));
  if (ui.panes.length < 3) { ui.panes.splice(i + 1, 0, rt); ui.active = i + 1; }
  else { const j = i < 2 ? i + 1 : 1; ui.panes[j] = rt; ui.active = j; }
  renderPanes(); renderSideActive();
}
function resetRoutes() { ui.panes.forEach((_, k) => runCleanup(k)); ui.panes = [{ v: 'overview' }]; ui.active = 0; renderPanes(); renderSide(); }

// ---------- 사이드바 ----------
function worldMenu(a) {
  menu(a, [
    ...D.worlds.map(w => ({ label: (w.id === D.cur.world ? '✓ ' : '   ') + w.name, onClick: () => { DB.setWorld(w.id); resetRoutes(); } })),
    { sep: true },
    { label: '＋ 새 세계관', onClick: async () => { const n = await promptDlg('새 세계관 이름', ''); if (!n) return; const w = DB.newWorld(n); D.worlds.push(w); DB.setWorld(w.id); resetRoutes(); } },
    { label: '이름 변경', onClick: async () => { const n = await promptDlg('세계관 이름', curWorld().name); if (n) { curWorld().name = n; saveSoon(); renderSide(); } } },
    { label: '세계관 삭제', danger: true, onClick: async () => {
      if (D.worlds.length < 2) return toast('마지막 세계관은 삭제할 수 없어요');
      const w = curWorld();
      if (!await confirmDlg(`'${w.name}' 세계관과 그 안의 작품·설정·아카이브를 모두 삭제할까요?\n되돌릴 수 없어요.`, '삭제', true)) return;
      const ids = new Set(D.works.filter(k => k.worldId === w.id).map(k => k.id));
      for (const k of ['docs', 'timelines', 'plots', 'graphs', 'maps', 'memos', 'works']) D[k] = D[k].filter(x => x.worldId !== w.id);
      D.subs = D.subs.filter(x => !ids.has(x.workId));
      D.worlds = D.worlds.filter(x => x.id !== w.id); DB.setWorld(D.worlds[0].id); resetRoutes();
    } },
  ]);
}
function workMenu(a) {
  menu(a, [
    ...worksOf().map(k => ({ label: (k.id === D.cur.work ? '✓ ' : '   ') + k.name, onClick: () => { D.cur.work = k.id; saveSoon(); resetRoutes(); } })),
    { sep: true },
    { label: '＋ 새 작품 (같은 세계관 공유)', onClick: async () => { const n = await promptDlg('새 작품 제목', ''); if (!n) return; const k = DB.newWork(D.cur.world, n); D.works.push(k); D.cur.work = k.id; saveSoon(); resetRoutes(); } },
    { label: '작품 제목 변경', onClick: async () => { const n = await promptDlg('작품 제목', curWork().name); if (n) { curWork().name = n; saveSoon(); renderSide(); } } },
    { label: '작품 삭제', danger: true, onClick: async () => {
      if (worksOf().length < 2) return toast('세계관에는 작품이 최소 하나 있어야 해요');
      const k = curWork();
      if (!await confirmDlg(`'${k.name}' 작품과 모든 회차를 삭제할까요?\n(캐릭터·설정은 세계관에 남아요)`, '삭제', true)) return;
      D.works = D.works.filter(x => x.id !== k.id); D.subs = D.subs.filter(x => x.workId !== k.id);
      D.cur.work = worksOf()[0].id; saveSoon(); resetRoutes();
    } },
  ]);
}
function renderSide() {
  const w = curWorld(), k = curWork();
  const on = navKey(ui.panes[ui.active]);
  const item = n => h('button', { class: 'nav' + (on === n[0] ? ' on' : ''), data: { key: n[0] }, onclick: () => { go(ui.active, { ...n[2] }); document.body.classList.remove('side-open'); } },
    h('i', {}, n[3]), n[1], n[0] === 'settings' && misc.hasUnreadNotice() ? h('span', { class: 'dot' }) : null);
  const by = key => NAV.find(n => n[0] === key);
  sideEl.replaceChildren(
    h('div', { class: 'brand' }, h('span', { class: 'logo' }, '✦'), h('b', {}, '설정집'), h('button', { class: 'iconbtn collapse', title: '사이드바 접기', onclick: () => { ui.collapsed = true; applyCollapse(); saveUI(); } }, '◀')),
    h('button', { class: 'ctxbtn world', onclick: e => worldMenu(e.currentTarget), title: '세계관 바꾸기' }, h('small', {}, '세계관'), h('span', {}, w.name), h('em', {}, '▾')),
    h('button', { class: 'ctxbtn work', onclick: e => workMenu(e.currentTarget), title: '작품 바꾸기' }, h('small', {}, '작품'), h('span', {}, k.name), h('em', {}, '▾')),
    h('nav', {},
      item(by('overview')), item(by('novel')),
      h('div', { class: 'navh' }, '설정'), item(by('docs:character')), item(by('docs:setting')),
      h('div', { class: 'navh' }, '아카이브'), item(by('timeline')), item(by('plot')), item(by('graph')), item(by('map')),
      h('div', { class: 'navh' }, '정리'), item(by('stats')), item(by('memo')),
      h('div', { class: 'navh' }, '관리'), item(by('subs')), item(by('settings'))),
    h('div', { class: 'side-foot' },
      window.__installEv ? h('button', { class: 'nav', onclick: misc.installApp }, h('i', {}, '⬇'), '앱 설치') : null,
      D.settings.lockHash ? h('button', { class: 'nav', onclick: () => misc.showLock() }, h('i', {}, '🔒'), '화면 잠금') : null,
      h('small', { class: 'muted' }, 'v' + DB.APP_VERSION)));
}
function renderSideActive() {
  const on = navKey(ui.panes[ui.active]);
  sideEl.querySelectorAll('.nav[data-key]').forEach(b => b.classList.toggle('on', b.dataset.key === on));
}
function applyCollapse() { document.body.classList.toggle('side-collapsed', ui.collapsed); }

// ---------- 상단바 / 검색 ----------
function miniList(a) {
  const eps = curWork().episodes;
  if (!eps.length) return toast('아직 회차가 없어요');
  let n = 0;
  menu(a, eps.map(e => { const num = e.extra ? '[외전] ' : `${++n}화 `; return ({ label: /^\s*(제\s*)?\d+\s*(화|회)/.test(e.title || '') ? e.title : num + (e.title || '제목 없음'), onClick: () => go(ui.active, { v: 'ep', id: e.id }) }); }));
}
function searchDlg() {
  const out = h('div', { class: 'results' });
  const q = h('input', { type: 'text', placeholder: '캐릭터·설정·회차 본문에서 검색', oninput: () => run() });
  const snip = (t, k) => { const i = t.toLowerCase().indexOf(k); if (i < 0) return ''; return (i > 30 ? '…' : '') + t.slice(Math.max(0, i - 30), i + 60).replace(/\n/g, ' '); };
  const run = debounce(() => {
    const k = q.value.trim().toLowerCase(); out.innerHTML = '';
    if (!k) return;
    const rows = [];
    DB.inWorld('docs').forEach(d => { const t = DB.docPlain(d); if (t.toLowerCase().includes(k)) rows.push({ kind: d.type === 'character' ? '캐릭터' : '설정', title: d.title, sn: d.title.toLowerCase().includes(k) ? d.summary : snip(t, k), rt: { v: 'doc', id: d.id } }); });
    curWork().episodes.forEach(e => { const t = plainFromHTML(e.html || ''); if ((e.title || '').toLowerCase().includes(k) || t.toLowerCase().includes(k)) rows.push({ kind: '회차', title: e.title || '제목 없음', sn: snip(t, k), rt: { v: 'ep', id: e.id } }); });
    out.append(...(rows.length ? rows.slice(0, 60).map(r => h('button', { class: 'result', onclick: () => { d.close(); go(ui.active, r.rt); } }, h('span', { class: 'badge' }, r.kind), h('b', {}, r.title), h('small', { class: 'muted' }, r.sn))) : [h('div', { class: 'empty' }, '결과가 없어요')]));
  }, 120);
  const d = dialog({ title: '전체 검색', body: h('div', { class: 'stack' }, q, out), wide: true });
  setTimeout(() => q.focus(), 30);
}
function buildShell() {
  const root = $('#boot'); root.id = 'app'; root.removeAttribute('style'); root.innerHTML = '';
  sideEl = h('aside', { id: 'side' });
  wrap = h('div', { class: 'panes' });
  const status = h('span', { class: 'savestat muted' }, '');
  document.addEventListener('lore-saved', () => { status.textContent = '저장됨'; status.classList.remove('bad'); });
  document.addEventListener('lore-save-error', () => { status.textContent = '⚠ 저장 실패 (저장공간 확인)'; status.classList.add('bad'); });
  const top = h('div', { id: 'topbar' },
    h('button', { class: 'iconbtn menu-btn', title: '메뉴', onclick: () => { if (isMobile()) document.body.classList.toggle('side-open'); else { ui.collapsed = !ui.collapsed; applyCollapse(); saveUI(); } } }, '☰'),
    h('span', { class: 'sp' }), status,
    h('button', { class: 'iconbtn', title: '회차 빠른 목록', onclick: e => miniList(e.currentTarget) }, '📖'),
    h('button', { class: 'iconbtn', title: '화면 분할 추가 (최대 3개)', onclick: addPane }, '◫'),
    h('button', { class: 'iconbtn', title: '검색 (Ctrl+K)', onclick: searchDlg }, '🔎'),
    h('button', { class: 'iconbtn', title: '지금 잠그기', onclick: () => (D.settings.lockHash ? misc.showLock() : toast('설정에서 화면 잠금 PIN을 먼저 만들어 주세요')) }, '🔒'));
  const main = h('main', { id: 'main', onmousedown: () => document.body.classList.remove('side-open') }, h('div', { id: 'banner' }), top, wrap);
  root.append(sideEl, main, h('button', { class: 'focus-exit', onclick: () => document.body.classList.remove('focus') }, '집중 모드 끝내기 (Esc)'));
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); searchDlg(); }
    if (e.key === 'Escape' && document.body.classList.contains('focus') && !document.querySelector('.overlay')) document.body.classList.remove('focus');
  });
  applyCollapse(); renderSide(); renderPanes();
}

async function boot() {
  try {
    await DB.initDB();
    misc.applySettings(); loadUI();
    ui.panes = ui.panes.filter(p => VIEW[p.v]); if (!ui.panes.length) ui.panes = [{ v: 'overview' }];
    if (D.settings.lockHash) await misc.showLock();
    buildShell();
    misc.initUpdateCheck($('#banner'), renderSide);
    window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); window.__installEv = e; renderSide(); });
    document.addEventListener('visibilitychange', () => { if (document.hidden && D.settings.lockOnHide && D.settings.lockHash) misc.showLock(); });
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) navigator.serviceWorker.register('sw.js').catch(() => {});
    window.__lore = { D, go: rt => go(ui.active, rt), ui };
  } catch (e) {
    console.error(e);
    $('#boot').innerHTML = `<div style="padding:24px;font-family:sans-serif"><h3>시작하지 못했어요</h3><pre style="white-space:pre-wrap">${esc(String(e && e.stack || e))}</pre><p>브라우저가 사이트 데이터 저장(IndexedDB)을 막고 있지 않은지 확인해 주세요. (시크릿 모드에서는 일부 브라우저가 저장을 막아요)</p></div>`;
  }
}
boot();
