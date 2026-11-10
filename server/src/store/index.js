import { CFG } from '../config.js';
import { fileStore } from './fileStore.js';

export let store = fileStore;
export async function initStore() {
  if (CFG.MONGO_URL) {
    try { store = (await import('./mongoStore.js')).mongoStore; await store.init(); return store; } catch (e) {
      console.warn(`MongoDB not reachable (${e.message}); falling back to file store in data/`);
      store = fileStore;
    }
  }
  await store.init();
  return store;
}
