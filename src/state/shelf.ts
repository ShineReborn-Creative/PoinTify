import { listen } from "@tauri-apps/api/event";
import { api, type ShelfItem } from "../lib/api";
import { createStore } from "../lib/store";

export const shelfStore = createStore<ShelfItem[]>([]);

export async function initShelf() {
  shelfStore.set(await api.shelfList());
  await listen<ShelfItem[]>("shelf-changed", (e) => shelfStore.set(e.payload));
}

export async function addToShelf(paths: string[]): Promise<ShelfItem[]> {
  const items = await api.shelfAdd(paths);
  shelfStore.set(items);
  return items;
}
