// 데이터 저장소: IndexedDB (JSON 본문 + 이미지 Blob)
import { uid } from './util.js';

export const APP_VERSION = '1.0.0';
export const D = {};            // 전체 데이터(메모리). 변경 후 saveSoon() 호출
let idb;
const imgs = new Map();         // id -> {blob,name,type}
const urls = new Map();         // id -> objectURL

const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const done = t => new Promise((res, rej) => { t.oncomplete = () => res(); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); });

function openDB() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('lore-site', 1);
    r.onupgradeneeded = () => { r.result.createObjectStore('kv'); r.result.createObjectStore('img'); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}

export const newWork = (worldId, name = '새 작품') => ({
  id: uid(), worldId, name, genre: '', summary: '', status: '구상 중', target: 100, created: Date.now(),
  folders: [], episodes: [], style: { font: 'serif', size: 17, lh: 1.9, align: 'left', indent: true, width: 720 },
});
export const newWorld = (name = '내 세계') => ({ id: uid(), name, created: Date.now() });

function newData() {
  const w = newWorld(); const k = newWork(w.id);
  return migrate({ worlds: [w], works: [k], cur: { world: w.id, work: k.id } });
}

function migrate(d) {
  d.version ||= 1;
  d.settings = Object.assign({ theme: 'dark', font: 'sans', fontSize: 15, lockHash: null, lockOnHide: false, noticeSeen: '', lastBackup: 0 }, d.settings);
  for (const k of ['worlds', 'works', 'docs', 'templates', 'timelines', 'plots', 'graphs', 'maps', 'memos', 'subs']) d[k] ||= [];
  d.cur ||= {};
  if (!d.worlds.length) d.worlds.push(newWorld());
  if (!d.worlds.find(w => w.id === d.cur.world)) d.cur.world = d.worlds[0].id;
  let ws = d.works.filter(w => w.worldId === d.cur.world);
  if (!ws.length) { const k = newWork(d.cur.world); d.works.push(k); ws = [k]; }
  if (!ws.find(w => w.id === d.cur.work)) d.cur.work = ws[0].id;
  if (!d.templates.length) {
    d.templates.push(
      { id: uid(), name: '캐릭터 기본', type: 'character', keys: ['나이', '성별', '소속', '직업'], sections: [{ title: '외모', children: [] }, { title: '성격', children: [] }, { title: '배경', children: [] }, { title: '관계', children: [] }] },
      { id: uid(), name: '작품설정 기본', type: 'setting', keys: ['분류'], sections: [{ title: '개요', children: [] }, { title: '세부 규칙', children: [] }] },
    );
  }
  d.works.forEach(w => { w.style ||= newWork('').style; w.folders ||= []; w.episodes ||= []; });
  return d;
}

export function setData(obj) {
  for (const k of Object.keys(D)) delete D[k];
  Object.assign(D, migrate(obj));
}

export async function initDB() {
  idb = await openDB();
  const data = await req(idb.transaction('kv').objectStore('kv').get('data'));
  const st = idb.transaction('img').objectStore('img');
  const keys = await req(st.getAllKeys()); const vals = await req(st.getAll());
  keys.forEach((k, i) => { imgs.set(k, vals[i]); urls.set(k, URL.createObjectURL(vals[i].blob)); });
  setData(data || newData());
  try { navigator.storage?.persist?.(); } catch { /* 무시 */ }
}

let timer;
export function saveSoon() { clearTimeout(timer); timer = setTimeout(saveNow, 300); }
export async function saveNow() {
  clearTimeout(timer);
  try {
    const t = idb.transaction('kv', 'readwrite'); t.objectStore('kv').put(D, 'data'); await done(t);
    document.dispatchEvent(new CustomEvent('lore-saved'));
  } catch (e) { console.error('저장 실패', e); document.dispatchEvent(new CustomEvent('lore-save-error', { detail: e })); }
}
addEventListener('pagehide', () => saveNow());
document.addEventListener('visibilitychange', () => { if (document.hidden) saveNow(); });

// ---------- 이미지 ----------
async function shrink(file) {
  if (!/^image\/(png|jpeg|webp|bmp)$/.test(file.type) || file.size < 1.5e6) return file;
  try {
    const bm = await createImageBitmap(file); const max = 2200;
    const sc = Math.min(1, max / Math.max(bm.width, bm.height));
    if (sc === 1 && file.size < 4e6) return file;
    const c = document.createElement('canvas'); c.width = Math.round(bm.width * sc); c.height = Math.round(bm.height * sc);
    c.getContext('2d').drawImage(bm, 0, 0, c.width, c.height);
    const out = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.9));
    return out && out.size < file.size ? out : file;
  } catch { return file; }
}
export async function putImageRaw(id, blob, name = '', type = blob.type) {
  const rec = { blob, name, type };
  const t = idb.transaction('img', 'readwrite'); t.objectStore('img').put(rec, id); await done(t);
  if (urls.has(id)) URL.revokeObjectURL(urls.get(id));
  imgs.set(id, rec); urls.set(id, URL.createObjectURL(blob));
  return id;
}
export async function addImageFile(file) { const b = await shrink(file); return putImageRaw(uid(), b, file.name || '', b.type); }
export const imgURL = id => urls.get(id) || '';
export const allImages = () => imgs;
export async function delImage(id) {
  const t = idb.transaction('img', 'readwrite'); t.objectStore('img').delete(id); await done(t);
  URL.revokeObjectURL(urls.get(id)); imgs.delete(id); urls.delete(id);
}
export async function clearAllStores() {
  const t = idb.transaction(['kv', 'img'], 'readwrite'); t.objectStore('kv').clear(); t.objectStore('img').clear(); await done(t);
  for (const u of urls.values()) URL.revokeObjectURL(u); imgs.clear(); urls.clear();
}

// ---------- 현재 세계관/작품 ----------
export const curWorld = () => D.worlds.find(w => w.id === D.cur.world);
export const curWork = () => D.works.find(w => w.id === D.cur.work);
export const worksOf = () => D.works.filter(w => w.worldId === D.cur.world);
export const inWorld = key => D[key].filter(x => x.worldId === D.cur.world);
export const docById = id => D.docs.find(d => d.id === id);
export const docByTitle = t => { const k = String(t).trim().toLowerCase(); return inWorld('docs').find(d => d.title.trim().toLowerCase() === k); };
export function setWorld(id) {
  D.cur.world = id;
  let ws = worksOf();
  if (!ws.length) { const k = newWork(id); D.works.push(k); ws = [k]; }
  D.cur.work = ws[0].id; saveSoon();
}

// ---------- 문서 텍스트 순회 ----------
export function mapDocText(doc, f) {
  doc.summary = f(doc.summary || '');
  (doc.infobox || []).forEach(r => { r.v = f(r.v || ''); });
  const sec = s => (s.blocks || []).forEach(b => {
    if (b.type === 'text') b.text = f(b.text || '');
    else if (b.type === 'table') b.rows = b.rows.map(r => r.map(c => f(c || '')));
    else if (b.type === 'image') b.caption = f(b.caption || '');
  });
  (doc.sections || []).forEach(s => { sec(s); (s.children || []).forEach(sec); });
}
export function docPlain(doc) {
  const out = [doc.title, doc.category, (doc.tags || []).join(' ')];
  (doc.infobox || []).forEach(r => out.push(r.k));
  (doc.sections || []).forEach(s => { out.push(s.title); (s.children || []).forEach(c => out.push(c.title)); });
  mapDocText(structuredClone(doc), t => { out.push(t); return t; });
  return out.join('\n');
}
export function renameDocRefs(oldT, newT) {
  if (!oldT || oldT === newT) return;
  const re = new RegExp('\\[\\[' + oldT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(\\||\\]\\])', 'g');
  inWorld('docs').forEach(d => mapDocText(d, t => t.replace(re, (m, c) => '[[' + newT + c)));
}
export function newDoc(type, title, tpl) {
  return {
    id: uid(), worldId: D.cur.world, type, title, summary: '', category: '', tags: [],
    infobox: (tpl?.keys || []).map(k => ({ k, v: '' })), images: [],
    sections: (tpl?.sections || []).map(s => ({ id: uid(), title: s.title, collapsed: false, blocks: [{ id: uid(), type: 'text', text: '' }], children: (s.children || []).map(c => ({ id: uid(), title: c, collapsed: false, blocks: [{ id: uid(), type: 'text', text: '' }] })) })),
    created: Date.now(), updated: Date.now(),
  };
}
