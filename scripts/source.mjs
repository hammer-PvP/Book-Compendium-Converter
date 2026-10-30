import {readLibraryBook} from "./library-source.mjs";
export const SOURCE_ROOT = "bcc/5etools/data/";

const promiseCache = new Map();
export async function readJson(relative, {optional = false} = {}) {
  const path = `${SOURCE_ROOT}${relative}`;
  if (!promiseCache.has(path)) {
    promiseCache.set(path, (async () => {
      const response = await fetch(path, {cache: "no-cache"});
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${path}`);
      return response.json();
    })());
  }
  try { return await promiseCache.get(path); }
  catch (error) {
    promiseCache.delete(path);
    if (optional) return null;
    throw error;
  }
}

export async function getBooks() {
  const data = await readJson("books.json");
  if (!Array.isArray(data.book)) throw new Error("data/books.json não contém o array book.");
  return data.book;
}

export const readBook = readLibraryBook;
