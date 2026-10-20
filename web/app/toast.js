import { createStore } from './lib.js';

export const toastStore = createStore({ items: [] });
let nextId = 1;

export function toast(message, kind = 'info', ms = 3500) {
  const id = nextId++;
  toastStore.set((s) => ({ items: [...s.items, { id, message, kind }] }));
  setTimeout(() => toastStore.set((s) => ({ items: s.items.filter((x) => x.id !== id) })), ms);
}
