// refreshBus.js
const listeners = new Set();
export function onRefresh(cb) { listeners.add(cb); return () => listeners.delete(cb); }
export function triggerRefresh() { listeners.forEach(cb => { try { cb(); } catch {} }); }