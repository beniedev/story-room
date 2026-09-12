// Keep the existing name so a still-open older editor also participates.
export const DEVICE_WRITER_LOCK_NAME = 'story-native:device-library-writer:v1';

// The callback must be synchronous: version check, Book and index writes belong
// to one critical section. No lock survives a write or belongs to an editor UI.
const indexedWrite = <T>(write: () => T): Promise<T> => new Promise((resolve, reject) => {
  const request = indexedDB.open('story-native-write-coordination', 1);
  let settled = false;
  const fail = (error: unknown) => { settled = true; reject(error); };
  request.onupgradeneeded = () => { request.result.createObjectStore('writes'); };
  request.onerror = () => fail(request.error ?? new Error('无法打开设备保存协调器。'));
  request.onblocked = () => fail(new Error('设备保存协调器正在更新，请刷新旧版本页面后重试。'));
  request.onsuccess = () => {
    const db = request.result;
    if (settled) { db.close(); return; }
    let result: T;
    let failure: unknown;
    try {
      const transaction = db.transaction('writes', 'readwrite');
      // Wait for this transaction's turn before touching localStorage.
      const turn = transaction.objectStore('writes').get('turn');
      turn.onsuccess = () => {
        try { result = write(); }
        catch (error) { failure = error; transaction.abort(); }
      };
      transaction.oncomplete = () => { db.close(); resolve(result); };
      transaction.onabort = () => {
        db.close();
        fail(failure ?? transaction.error ?? new Error('设备保存协调失败，请重试。'));
      };
    } catch (error) { db.close(); fail(error); }
  };
});

export const withDeviceLibraryWrite = async <T>(write: () => T): Promise<T> => {
  let manager: LockManager | undefined;
  try { manager = globalThis.navigator?.locks; } catch { /* IndexedDB also works without Web Locks. */ }
  const hasIndexedDB = typeof globalThis.indexedDB !== 'undefined';
  const run = () => hasIndexedDB ? indexedWrite(write) : Promise.resolve().then(write);
  if (typeof manager?.request === 'function') {
    return manager.request(DEVICE_WRITER_LOCK_NAME, { mode: 'exclusive' }, run);
  }
  if (hasIndexedDB) return indexedWrite(write);
  throw new Error('浏览器无法协调设备保存；当前编辑仍保留，请导出 JSON 备份。');
};
