// 静时 · 手机本地存储（IndexedDB）。记录主键 = 开始时间 s。

const DB = 'jingshi', STORE = 'sessions';
let dbp = null;

function open() {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 's' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbp;
}

async function run(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req ? req.result : undefined);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export const all = () => run('readonly', (st) => st.getAll());
export const put = (r) => run('readwrite', (st) => { st.put(r); });
export const putMany = (list) => run('readwrite', (st) => { for (const r of list) st.put(r); });

// 请浏览器别在空间紧张时清掉我们的数据（iOS 主屏幕 app 一般会同意）
export function persist() {
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
}
