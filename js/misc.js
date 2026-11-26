// 작품 개요, 통계, 메모, 투고 관리, 설정(테마·잠금·백업·업데이트)
import { h, $, uid, toast, dialog, confirmDlg, promptDlg, sel, inp, area, field, download, pickFiles, fmtDate, fmtDT, ago, debounce, plainFromHTML, countChars, blobToDataURL, esc } from './util.js';
import * as DB from './db.js';
import { D, curWork, curWorld, worksOf, inWorld, saveSoon } from './db.js';
import { makeZip, readZip } from './zip.js';

export const FONT_STACKS = {
  sans: "'Pretendard','Noto Sans KR','Apple SD Gothic Neo','Malgun Gothic',system-ui,sans-serif",
  serif: "'Noto Serif KR','Nanum Myeongjo','Batang','Apple Myungjo',serif",
  round: "'Nanum Gothic','NanumSquare','Noto Sans KR','Malgun Gothic',sans-serif",
  mono: "'D2Coding','Consolas','Menlo',monospace",
};
export const FONT_LABELS = [['sans', '고딕'], ['serif', '명조'], ['round', '나눔고딕 계열'], ['mono', '고정폭']];
const THEMES = [['dark', '다크'], ['light', '라이트'], ['sepia', '세피아'], ['night', '미드나잇']];
const THEME_COLOR = { dark: '#0f0e13', light: '#f6f5f1', sepia: '#f1e7d3', night: '#0c0f1d' };

export function applySettings() {
  const st = D.settings, r = document.documentElement;
  r.dataset.theme = st.theme; r.style.setProperty('--ff', FONT_STACKS[st.font] || FONT_STACKS.sans); r.style.setProperty('--fs', st.fontSize + 'px');
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', THEME_COLOR[st.theme] || '#0f0e13');
}

// ---------- 잠금 ----------
async function hashPin(pin) {
  const data = new TextEncoder().encode('lore|' + pin);
  if (globalThis.crypto?.subtle) { const b = await crypto.subtle.digest('SHA-256', data); return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join(''); }
  let x = 5381; for (const c of data) x = ((x << 5) + x + c) | 0; return 'f' + x;
}
let lockP = null;
export function showLock() {
  if (lockP) return lockP;
  lockP = new Promise(res => {
    const input = h('input', { type: 'password', inputMode: 'numeric', placeholder: 'PIN', autocomplete: 'off' });
    const msg = h('div', { class: 'lock-msg' });
    const tryOpen = async () => {
      if (await hashPin(input.value) === D.settings.lockHash) { ov.remove(); lockP = null; res(); }
      else { msg.textContent = 'PIN이 달라요'; input.value = ''; input.focus(); }
    };
    const ov = h('div', { class: 'lockscreen' }, h('div', { class: 'lockbox' }, h('div', { class: 'logo big' }, '✦'), h('h3', {}, '설정집'), input, h('button', { class: 'btn primary', onclick: tryOpen }, '열기'), msg));
    input.addEventListener('keydown', e => { if (e.key === 'Enter') tryOpen(); });
    document.body.append(ov); input.focus();
  });
  return lockP;
}
const askPin = label => new Promise(res => {
  const i = h('input', { type: 'password', inputMode: 'numeric', autocomplete: 'off' });
  const d = dialog({ title: label, body: i, buttons: [{ label: '취소', onClick: c => { res(null); c(); } }, { label: '확인', kind: 'primary', onClick: c => { res(i.value); c(); } }], onClose: () => res(null) });
  i.addEventListener('keydown', e => { if (e.key === 'Enter') { res(i.value); d.close(); } });
  setTimeout(() => i.focus(), 30);
});

// ---------- 업데이트 / 공지 / 설치 ----------
let remote = null;
export const hasUnreadNotice = () => { const n = remote?.notices?.[0]; return !!n && n.id !== D.settings.noticeSeen; };
export async function checkRemote() {
  try { const r = await fetch('version.json?' + Date.now(), { cache: 'no-store' }); if (!r.ok) return null; remote = await r.json(); return remote; } catch { return null; }
}
async function hardReload() {
  try {
    const regs = await navigator.serviceWorker?.getRegistrations(); if (regs) await Promise.all(regs.map(r => r.unregister()));
    const ks = await caches.keys(); await Promise.all(ks.map(k => caches.delete(k)));
  } catch { /* 무시 */ }
  location.reload();
}
export async function initUpdateCheck(bannerEl, onChange) {
  const r = await checkRemote(); if (!r) return;
  if (r.version && r.version !== DB.APP_VERSION) {
    bannerEl.replaceChildren(h('div', { class: 'banner' }, `새 버전 ${r.version}이 나왔어요. `, h('button', { class: 'btn sm primary', onclick: hardReload }, '지금 업데이트'), h('button', { class: 'iconbtn', onclick: e => e.target.parentNode.remove() }, '✕')));
  }
  onChange && onChange();
}
export function installApp() {
  const e = window.__installEv;
  if (!e) return toast('주소창 또는 브라우저 메뉴의 "설치 / 홈 화면에 추가"를 이용해 주세요');
  e.prompt(); e.userChoice.finally(() => { window.__installEv = null; });
}

// ---------- 백업 ----------
export async function exportZip() {
  const files = [{ name: 'data.json', data: JSON.stringify(D) }]; const meta = {};
  for (const [id, rec] of DB.allImages()) { meta[id] = { name: rec.name, type: rec.type }; files.push({ name: 'images/' + id, data: rec.blob }); }
  files.push({ name: 'images.json', data: JSON.stringify(meta) });
  files.push({ name: 'README.txt', data: '설정집 전체 백업입니다. 설정 > 백업 불러오기에서 이 zip 파일을 선택하면 복원됩니다.\ndata.json = 글/설정 데이터, images/ = 이미지 원본' });
  const stamp = new Date().toISOString().slice(0, 10);
  download(await makeZip(files), `설정집-백업-${stamp}.zip`);
  D.settings.lastBackup = Date.now(); saveSoon();
}
async function exportJSON() {
  const images = {};
  for (const [id, rec] of DB.allImages()) images[id] = { name: rec.name, type: rec.type, data: await blobToDataURL(rec.blob) };
  download(new Blob([JSON.stringify({ app: 'lore', data: D, images })], { type: 'application/json' }), `설정집-백업-${new Date().toISOString().slice(0, 10)}.json`);
  D.settings.lastBackup = Date.now(); saveSoon();
}
async function importBackup() {
  const [f] = await pickFiles('.zip,.json'); if (!f) return;
  if (!await confirmDlg('현재 데이터를 모두 이 백업 내용으로 바꿉니다.\n계속할까요? (먼저 현재 상태를 백업해 두면 안전해요)', '가져오기', true)) return;
  try {
    let data; const imgs = [];
    if (/\.json$/i.test(f.name)) {
      const o = JSON.parse(await f.text());
      data = o.data || o;
      for (const [id, m] of Object.entries(o.images || {})) imgs.push([id, await (await fetch(m.data)).blob(), m.name, m.type]);
    } else {
      const z = await readZip(await f.arrayBuffer());
      data = JSON.parse(await z.readText('data.json'));
      const meta = JSON.parse((await z.readText('images.json')) || '{}');
      for (const [id, m] of Object.entries(meta)) { const b = await z.read('images/' + id); if (b) imgs.push([id, new Blob([b], { type: m.type }), m.name, m.type]); }
    }
    if (!data || !data.worlds) throw new Error('설정집 백업 파일이 아니에요');
    await DB.clearAllStores();
    for (const [id, b, n, t] of imgs) await DB.putImageRaw(id, b, n, t);
    DB.setData(data); await DB.saveNow(); localStorage.removeItem('lore-ui'); location.reload();
  } catch (e) { console.error(e); toast('백업을 읽지 못했어요: ' + e.message, 4000); }
}

// ---------- 작품 개요 ----------
const card = (title, ...kids) => h('section', { class: 'card' }, title ? h('h3', {}, title) : null, ...kids);
const tile = (n, label) => h('div', { class: 'tile' }, h('b', {}, n), h('span', {}, label));
const STATUS = ['구상 중', '집필 중', '연재 중', '휴재', '완결', '보류'];

export function overview(root, rt, ctx) {
  const wk = curWork(), eps = wk.episodes;
  const total = eps.reduce((a, e) => a + countChars(plainFromHTML(e.html || '')).nospace, 0);
  const main = eps.filter(e => !e.extra).length;
  const commit = debounce(() => { saveSoon(); ctx.refresh(); ctx.changed(); }, 400);
  const bar = h('div', { class: 'bar' }, h('i', { style: { width: Math.min(100, wk.target ? main / wk.target * 100 : 0) + '%' } }));
  const barTxt = h('span', { class: 'muted' }, '');
  const upd = () => { bar.firstChild.style.width = Math.min(100, wk.target ? main / wk.target * 100 : 0) + '%'; barTxt.textContent = `${main} / ${wk.target || 0}화 (${wk.target ? Math.round(main / wk.target * 100) : 0}%)`; };
  upd();
  const recentEps = [...eps].sort((a, b) => (b.updated || 0) - (a.updated || 0)).slice(0, 5);
  const recentDocs = [...inWorld('docs')].sort((a, b) => (b.updated || 0) - (a.updated || 0)).slice(0, 5);
  const warnBackup = !D.settings.lastBackup || Date.now() - D.settings.lastBackup > 7 * 864e5;
  root.append(
    h('div', { class: 'view-head' }, h('h2', {}, '작품 개요'), h('span', { class: 'muted' }, `${curWorld().name} · ${wk.name}`)),
    h('div', { class: 'grid2' },
      card('작품 정보',
        field('제목', inp(wk.name, v => { wk.name = v; commit(); })),
        h('div', { class: 'row2' }, field('장르', inp(wk.genre, v => { wk.genre = v; commit(); })), field('상태', sel(STATUS, wk.status, v => { wk.status = v; commit(); }))),
        field('한 줄 소개', area(wk.summary, v => { wk.summary = v; commit(); }, { rows: 3 })),
        field('목표 회차', h('input', { type: 'number', min: 1, value: wk.target || 100, oninput: e => { wk.target = +e.target.value || 0; upd(); commit(); } })),
        h('div', { class: 'stack sm' }, bar, barTxt)),
      card('작품 통계', h('div', { class: 'tiles' },
        tile(eps.length, '전체 회차'), tile(total.toLocaleString(), '총 글자수(공백 제외)'), tile(eps.length ? Math.round(total / eps.length).toLocaleString() : 0, '회차 평균 글자수'),
        tile(inWorld('docs').filter(d => d.type === 'character').length, '캐릭터'), tile(inWorld('docs').filter(d => d.type === 'setting').length, '작품설정'),
        tile(inWorld('timelines').reduce((a, t) => a + t.events.length, 0), '타임라인 이벤트'), tile(inWorld('plots').reduce((a, p) => a + p.cards.length, 0), '플롯 카드'), tile(inWorld('maps').length, '지도'))),
    ),
    h('div', { class: 'grid2' },
      card('최근 수정한 회차', recentEps.length ? recentEps.map(e => h('button', { class: 'listrow', onclick: () => ctx.go({ v: 'ep', id: e.id }) }, h('b', {}, e.title || '제목 없음'), h('small', { class: 'muted' }, ago(e.updated)))) : h('div', { class: 'muted' }, '아직 회차가 없어요. 소설 메뉴에서 첫 회차를 만들어 보세요.')),
      card('최근 수정한 설정', recentDocs.length ? recentDocs.map(d => h('button', { class: 'listrow', onclick: () => ctx.go({ v: 'doc', id: d.id }) }, h('b', {}, d.title), h('small', { class: 'muted' }, (d.type === 'character' ? '캐릭터' : '설정') + ' · ' + ago(d.updated)))) : h('div', { class: 'muted' }, '캐릭터와 작품설정을 만들어 보세요.')),
    ),
    card('백업', h('div', { class: 'row' }, h('span', { class: warnBackup ? 'warn' : 'muted' }, `마지막 백업: ${D.settings.lastBackup ? ago(D.settings.lastBackup) : '아직 없음'}`), h('span', { class: 'sp' }), h('button', { class: 'btn', onclick: async () => { await exportZip(); toast('백업 파일을 내려받았어요'); ctx.rerender(); } }, '전체 백업(.zip) 받기')),
      h('small', { class: 'muted' }, '데이터는 이 브라우저에만 저장돼요. 브라우저 데이터를 지우면 사라지니, 가끔 백업 파일을 받아 두세요.')));
}

// ---------- 캐릭터 통계 ----------
const bars = (title, entries) => {
  const max = Math.max(1, ...entries.map(e => e[1]));
  return card(title, entries.length ? h('div', { class: 'bars' }, entries.map(([k, v]) => h('div', { class: 'barrow' }, h('span', { class: 'bl' }, k), h('div', { class: 'bar' }, h('i', { style: { width: v / max * 100 + '%' } })), h('b', {}, v)))) : h('div', { class: 'muted' }, '데이터가 없어요'));
};
const tally = arr => { const m = new Map(); arr.forEach(x => m.set(x, (m.get(x) || 0) + 1)); return [...m].sort((a, b) => b[1] - a[1]); };
export function stats(root, rt, ctx) {
  const chars = inWorld('docs').filter(d => d.type === 'character');
  const epText = curWork().episodes.map(e => plainFromHTML(e.html || '') + ' ' + (e.html || ''));
  const appear = chars.map(c => [c.title, epText.filter(t => t.includes(c.title) || t.includes(`data-doc="${c.id}"`)).length]).sort((a, b) => b[1] - a[1]);
  const keys = new Map();
  chars.forEach(c => c.infobox.forEach(r => { if (r.k && r.v) { (keys.get(r.k) || keys.set(r.k, []).get(r.k)).push(r.v.trim()); } }));
  root.append(h('div', { class: 'view-head' }, h('h2', {}, '캐릭터 통계'), h('span', { class: 'muted' }, `캐릭터 ${chars.length}명`)));
  if (!chars.length) return root.append(h('div', { class: 'empty' }, '캐릭터를 만들면 분류·태그·정보 항목별 통계가 여기에 나타나요.'));
  root.append(h('div', { class: 'grid2' },
    bars('분류별', tally(chars.map(c => c.category || '(미분류)'))),
    bars('태그별', tally(chars.flatMap(c => c.tags)).slice(0, 15)),
    bars('회차 등장 횟수 (이름 언급 기준)', appear.slice(0, 15)),
    ...[...keys].filter(([, v]) => v.length >= 2 && new Set(v).size <= 14).slice(0, 6).map(([k, v]) => bars(`${k} 분포`, tally(v)))));
}

// ---------- 메모 ----------
export function memo(root, rt, ctx) {
  const list = inWorld('memos').sort((a, b) => (b.updated || 0) - (a.updated || 0));
  const cur = list.find(m => m.id === rt.id) || list[0];
  const left = h('div', { class: 'memo-list' }, list.map(m => h('button', { class: 'listrow' + (m === cur ? ' on' : ''), onclick: () => ctx.go({ v: 'memo', id: m.id }) }, h('b', {}, m.title || '제목 없음'), h('small', { class: 'muted' }, (m.body || '').replace(/\n/g, ' ').slice(0, 40)))));
  const add = () => { const m = { id: uid(), worldId: D.cur.world, title: '', body: '', updated: Date.now() }; D.memos.push(m); saveSoon(); ctx.go({ v: 'memo', id: m.id }); };
  root.append(h('div', { class: 'view-head' }, h('h2', {}, '메모 보관함'), h('span', { class: 'sp' }), h('button', { class: 'btn primary sm', onclick: add }, '＋ 새 메모')));
  if (!cur) return root.append(h('div', { class: 'empty' }, '아이디어, 떠오른 대사, 자료 링크를 자유롭게 적어 두세요.'));
  const commit = debounce(() => { cur.updated = Date.now(); saveSoon(); ctx.changed(); }, 500);
  const title = inp(cur.title, v => { cur.title = v; commit(); }, { placeholder: '제목' });
  const body = area(cur.body, v => { cur.body = v; commit(); }, { placeholder: '내용', class: 'memo-body' });
  root.append(h('div', { class: 'split' }, left, h('div', { class: 'memo-edit stack' }, title, body,
    h('div', { class: 'row' }, h('small', { class: 'muted' }, '자동 저장'), h('span', { class: 'sp' }), h('button', { class: 'btn danger sm', onclick: async () => { if (await confirmDlg('이 메모를 삭제할까요?', '삭제', true)) { D.memos = D.memos.filter(m => m !== cur); saveSoon(); ctx.go({ v: 'memo' }); } } }, '삭제')))));
  return () => commit.flush();
}

// ---------- 투고 관리 ----------
const SUB_STATUS = ['준비 중', '투고함', '검토 중', '계약', '연재 중', '반려', '철회'];
export function subs(root, rt, ctx) {
  const commit = debounce(() => { saveSoon(); }, 400);
  const add = () => { D.subs.push({ id: uid(), workId: D.cur.work, platform: '', date: new Date().toISOString().slice(0, 10), status: '준비 중', memo: '' }); saveSoon(); ctx.rerender(); };
  root.append(h('div', { class: 'view-head' }, h('h2', {}, '투고 관리'), h('span', { class: 'muted' }, '공모전·플랫폼 투고 현황을 기록해요'), h('span', { class: 'sp' }), h('button', { class: 'btn primary sm', onclick: add }, '＋ 투고 기록')));
  if (!D.subs.length) return root.append(h('div', { class: 'empty' }, '아직 투고 기록이 없어요.'));
  const works = D.works.map(w => [w.id, w.name]);
  root.append(h('div', { class: 'tablewrap' }, h('table', { class: 'tbl' },
    h('thead', {}, h('tr', {}, ['작품', '플랫폼 / 공모전', '날짜', '상태', '메모', ''].map(t => h('th', {}, t)))),
    h('tbody', {}, D.subs.map(r => h('tr', {},
      h('td', {}, sel(works, r.workId, v => { r.workId = v; commit(); })),
      h('td', {}, inp(r.platform, v => { r.platform = v; commit(); })),
      h('td', {}, h('input', { type: 'date', value: r.date, oninput: e => { r.date = e.target.value; commit(); } })),
      h('td', {}, sel(SUB_STATUS, r.status, v => { r.status = v; commit(); })),
      h('td', {}, inp(r.memo, v => { r.memo = v; commit(); })),
      h('td', {}, h('button', { class: 'iconbtn', title: '삭제', onclick: async () => { if (await confirmDlg('이 기록을 삭제할까요?', '삭제', true)) { D.subs = D.subs.filter(x => x !== r); saveSoon(); ctx.rerender(); } } }, '🗑'))))))));
  return () => commit.flush();
}

// ---------- 설정 ----------
export function settings(root, rt, ctx) {
  const st = D.settings;
  const commit = () => { saveSoon(); applySettings(); };
  const themeBtns = h('div', { class: 'chips' });
  const drawThemes = () => themeBtns.replaceChildren(...THEMES.map(([k, l]) => h('button', { class: 'themebtn' + (st.theme === k ? ' on' : ''), data: { t: k }, onclick: () => { st.theme = k; commit(); drawThemes(); } }, h('i', { class: 'sw sw-' + k }), l)));
  drawThemes();

  const lockBox = h('div', { class: 'stack' });
  const drawLock = () => {
    lockBox.replaceChildren();
    if (!st.lockHash) {
      const p1 = h('input', { type: 'password', inputMode: 'numeric', placeholder: '새 PIN (4자리 이상)', autocomplete: 'new-password' });
      const p2 = h('input', { type: 'password', inputMode: 'numeric', placeholder: 'PIN 확인', autocomplete: 'new-password' });
      lockBox.append(h('div', { class: 'row' }, p1, p2, h('button', { class: 'btn primary', onclick: async () => {
        if (p1.value.length < 4) return toast('PIN은 4자리 이상으로 해주세요');
        if (p1.value !== p2.value) return toast('두 PIN이 달라요');
        st.lockHash = await hashPin(p1.value); commit(); toast('화면 잠금을 켰어요'); drawLock(); ctx.refresh();
      } }, '잠금 켜기')));
    } else {
      lockBox.append(
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: !!st.lockOnHide, onchange: e => { st.lockOnHide = e.target.checked; commit(); } }), '다른 탭·앱으로 나갔다 오면 자동으로 잠그기'),
        h('div', { class: 'row' },
          h('button', { class: 'btn', onclick: () => showLock() }, '지금 잠그기'),
          h('button', { class: 'btn', onclick: async () => {
            const cur = await askPin('현재 PIN'); if (cur == null) return;
            if (await hashPin(cur) !== st.lockHash) return toast('PIN이 달라요');
            const n = await askPin('새 PIN (4자리 이상)'); if (!n || n.length < 4) return toast('PIN은 4자리 이상이어야 해요');
            st.lockHash = await hashPin(n); commit(); toast('PIN을 바꿨어요');
          } }, 'PIN 변경'),
          h('button', { class: 'btn danger', onclick: async () => {
            const cur = await askPin('현재 PIN'); if (cur == null) return;
            if (await hashPin(cur) !== st.lockHash) return toast('PIN이 달라요');
            st.lockHash = null; st.lockOnHide = false; commit(); drawLock(); ctx.refresh(); toast('잠금을 껐어요');
          } }, '잠금 끄기')));
    }
  };
  drawLock();

  const noticeBox = h('div', { class: 'stack sm' }, h('span', { class: 'muted' }, '불러오는 중…'));
  const drawNotices = r => {
    noticeBox.replaceChildren();
    if (!r) return noticeBox.append(h('span', { class: 'muted' }, '공지를 불러오지 못했어요 (오프라인이거나 로컬 파일로 열었을 수 있어요)'));
    if (r.version !== DB.APP_VERSION) noticeBox.append(h('div', { class: 'banner inline' }, `새 버전 ${r.version}이 있어요. `, h('button', { class: 'btn sm primary', onclick: hardReload }, '업데이트')));
    else noticeBox.append(h('span', { class: 'muted' }, '최신 버전이에요.'));
    (r.notices || []).forEach(n => noticeBox.append(h('div', { class: 'notice' }, h('b', {}, n.title), h('small', { class: 'muted' }, n.date), h('p', {}, n.body))));
    if (r.notices?.[0]) { st.noticeSeen = r.notices[0].id; saveSoon(); ctx.refresh(); }
  };
  checkRemote().then(drawNotices);

  root.append(h('div', { class: 'view-head' }, h('h2', {}, '설정')),
    h('div', { class: 'grid2' },
      card('화면', field('테마', themeBtns),
        h('div', { class: 'row2' },
          field('글꼴', sel(FONT_LABELS, st.font, v => { st.font = v; commit(); })),
          field('글자 크기 (' + st.fontSize + 'px)', h('input', { type: 'range', min: 13, max: 20, step: 1, value: st.fontSize, oninput: e => { st.fontSize = +e.target.value; commit(); e.target.previousSibling.textContent = '글자 크기 (' + st.fontSize + 'px)'; } })))),
      card('화면 잠금', lockBox, h('small', { class: 'muted' }, '화면을 가리는 용도예요. 데이터를 암호화하지는 않으니, 중요한 정보는 기기 잠금도 함께 써 주세요.'))),
    h('div', { class: 'grid2' },
      card('백업 / 복원',
        h('div', { class: 'stack sm' },
          h('div', { class: warnBackupCls() }, `마지막 백업: ${st.lastBackup ? fmtDT(st.lastBackup) + ' (' + ago(st.lastBackup) + ')' : '아직 없음'}`),
          h('div', { class: 'row wrap' },
            h('button', { class: 'btn primary', onclick: async () => { await exportZip(); toast('전체 백업을 내려받았어요'); ctx.rerender(); } }, '전체 백업(.zip)'),
            h('button', { class: 'btn', onclick: exportJSON }, 'JSON 백업'),
            h('button', { class: 'btn', onclick: importBackup }, '백업 불러오기')),
          h('small', { class: 'muted' }, 'zip에는 글·설정(data.json)과 이미지 원본이 함께 들어가요. JSON 백업은 이미지를 안에 포함해요.'),
          h('button', { class: 'btn sm', onclick: async () => {
            const used = JSON.stringify(D); let n = 0;
            for (const id of [...DB.allImages().keys()]) if (!used.includes(id)) { await DB.delImage(id); n++; }
            toast(n ? `쓰이지 않는 이미지 ${n}개를 정리했어요` : '정리할 이미지가 없어요');
          } }, '쓰지 않는 이미지 정리'))),
      card('앱 / 업데이트',
        h('div', { class: 'row wrap' }, h('span', {}, '현재 버전 v' + DB.APP_VERSION), h('button', { class: 'btn sm', onclick: installApp }, '앱으로 설치'), h('button', { class: 'btn sm', onclick: async () => { drawNotices(await checkRemote()); } }, '업데이트 확인')),
        noticeBox)),
    card('위험 구역', h('div', { class: 'row' }, h('span', { class: 'muted' }, '이 브라우저에 저장된 모든 데이터를 지웁니다. 되돌릴 수 없어요.'), h('span', { class: 'sp' }),
      h('button', { class: 'btn danger', onclick: async () => {
        if (!await confirmDlg('정말 모든 데이터를 삭제할까요?\n먼저 백업을 받아 두었는지 확인하세요.', '계속', true)) return;
        const t = await promptDlg("확인을 위해 '삭제'라고 입력해 주세요", ''); if (t !== '삭제') return toast('취소했어요');
        await DB.clearAllStores(); localStorage.removeItem('lore-ui'); location.reload();
      } }, '모든 데이터 삭제'))));
}
const warnBackupCls = () => (!D.settings.lastBackup || Date.now() - D.settings.lastBackup > 7 * 864e5 ? 'warn' : 'muted');
