// 静时 · 定时静心的本机存储（数据很小，放 localStorage）。开了备份时整份同步到 GitHub 的 data/plans.json。
import { mergePlans } from './logic.js?v=0.8.1';

const KEY = 'jingshi.plans', DIRTY = 'jingshi.plansDirty';

export function get() {
  try { return mergePlans(JSON.parse(localStorage.getItem(KEY)) || {}, {}); } catch { return { items: [], skip: {} }; }
}

// 本机改了：存下来并标记「要同步」
export function set(plans) {
  try {
    localStorage.setItem(KEY, JSON.stringify(mergePlans(plans, {})));
    localStorage.setItem(DIRTY, '1');
  } catch {}
}

// 从备份同步回来：存下来，不用再推
export function setSynced(plans) {
  try { localStorage.setItem(KEY, JSON.stringify(mergePlans(plans, {}))); } catch {}
}

export const isDirty = () => { try { return !!localStorage.getItem(DIRTY); } catch { return false; } };
export const clearDirty = () => { try { localStorage.removeItem(DIRTY); } catch {} };
