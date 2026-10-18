// 静时 · 备份到 GitHub 私有仓库。一年一个文件：data/2026.json。
// 每次同步都是「拉远端 → 与本地合并 → 写回本地 → 有变化才推远端」，
// 所以换新手机时只要填好钥匙，旧记录会自己回来，也不会把远端的旧记录盖掉。

import { merge, encodeYear, decode, yearOf } from './logic.js?v=0.6.2';
import * as store from './store.js?v=0.6.2';

const CFG = 'jingshi.gh', DIRTY = 'jingshi.dirty', STATUS = 'jingshi.sync';

const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

export const getConfig = () => read(CFG, null);
export const setConfig = (cfg) => write(CFG, cfg);
export const getStatus = () => read(STATUS, null);
// 记下这次同步结果；连续失败时保留第一次失败的时间（since），用来判断「没网是不是已经太久」
function setStatus(ok, msg, net = false) {
  const now = Date.now(), prev = read(STATUS, null);
  const since = ok ? null : prev && !prev.ok ? prev.since || prev.at : now;
  write(STATUS, { at: now, ok, msg, net, since });
}
const recordFailure = (e) => setStatus(false, e.message, !!e.net);

export function markDirty(year) {
  const d = new Set(read(DIRTY, []));
  d.add(year);
  write(DIRTY, [...d]);
}

async function api(cfg, path, opts = {}) {
  let res;
  try {
    res = await fetch(`https://api.github.com/repos/${cfg.repo}${path}`, {
      ...opts,
      cache: 'no-store',
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
      },
    });
  } catch {
    const e = new Error('连不上 GitHub，联网后会自动补上');
    e.net = true;
    throw e;
  }
  return res;
}

async function fail(res) {
  if (res.status === 401) return new Error('钥匙无效或已过期，请换一把新的');
  if (res.status === 403) return new Error('钥匙没有这个仓库的读写权限');
  if (res.status === 404) return new Error('找不到这个仓库（或钥匙看不到它）');
  let msg = '';
  try { msg = (await res.json()).message || ''; } catch {}
  return new Error(`GitHub 返回 ${res.status} ${msg}`.trim());
}

async function fetchYear(cfg, year) {
  const res = await api(cfg, `/contents/data/${year}.json`);
  if (res.status === 404) return { sha: null, list: [], text: '' };
  if (!res.ok) throw await fail(res);
  const j = await res.json();
  const text = atob(j.content.replace(/\s/g, ''));
  return { sha: j.sha, list: decode(text), text };
}

async function syncYear(cfg, year, retry = true) {
  const local = (await store.all()).filter((r) => yearOf(r.s) === year);
  const remote = await fetchYear(cfg, year);
  const merged = merge(local, remote.list);

  const byId = new Map(local.map((r) => [r.s, r]));
  const fresh = merged.filter((r) => { const l = byId.get(r.s); return !l || !!l.x !== !!r.x; });
  if (fresh.length) await store.putMany(fresh);

  const text = encodeYear(year, merged);
  if (text === remote.text) return;
  const res = await api(cfg, `/contents/data/${year}.json`, {
    method: 'PUT',
    body: JSON.stringify({ message: `静心记录 ${year}`, content: btoa(text), ...(remote.sha ? { sha: remote.sha } : {}) }),
  });
  if ((res.status === 409 || res.status === 422) && retry) return syncYear(cfg, year, false);
  if (!res.ok) throw await fail(res);
}

// 同步排队一个一个来，免得两次同步同时改同一个文件
let chain = Promise.resolve();
function queued(fn) {
  const p = chain.then(fn);
  chain = p.catch(() => {});
  return p;
}

// 只同步改动过的年份（每次出定、删除之后）；失败不抛，记在状态里，下次再补
export function syncDirty() {
  return queued(async () => {
    const cfg = getConfig();
    const years = read(DIRTY, []);
    if (!cfg || !years.length) return;
    try {
      for (const y of years) {
        await syncYear(cfg, y);
        write(DIRTY, read(DIRTY, []).filter((d) => d !== y));
      }
      setStatus(true, '');
    } catch (e) {
      recordFailure(e);
    }
  });
}

// 全量同步：远端有的年份 + 本地有的年份（填好钥匙、导入文件之后）
export function syncAll() {
  return queued(async () => {
    const cfg = getConfig();
    if (!cfg) throw new Error('还没设置备份');
    try {
      const res = await api(cfg, '/contents/data');
      let years = [];
      if (res.ok) {
        years = (await res.json()).map((f) => /^(\d{4})\.json$/.exec(f.name)).filter(Boolean).map((m) => Number(m[1]));
      } else if (res.status !== 404) {
        throw await fail(res);
      }
      const local = (await store.all()).map((r) => yearOf(r.s));
      for (const y of new Set([...years, ...local])) await syncYear(cfg, y);
      write(DIRTY, []);
      setStatus(true, '');
    } catch (e) {
      recordFailure(e);
      throw e;
    }
  });
}

// 保存钥匙前先验一下：能不能读写、是不是私有仓库
export async function check(cfg) {
  const res = await api(cfg, '');
  if (!res.ok) throw await fail(res);
  const j = await res.json();
  if (!j.private) throw new Error('这个仓库是公开的，记录会被别人看到。请换成私有仓库');
  if (j.permissions && !j.permissions.push) throw new Error('钥匙只能读不能写，请给「Contents」开读写权限');
}
