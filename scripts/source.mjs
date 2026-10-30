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

async function readSeries(indexPath, folder, sourceId) {
  const index = await readJson(indexPath, {optional: true});
  if (!index) return [];
  const entries = Object.entries(index).filter(([key]) => key.toLowerCase() === sourceId.toLowerCase());
  const files = [...new Set(entries.map(([, path]) => path))];
  const all = await Promise.all(files.map(name => readJson(`${folder}/${name}`, {optional: true})));
  return all.filter(Boolean);
}

export async function readBook(id) {
  const sourceId = String(id).trim();
  const books = await getBooks();
  const book = books.find(b => b.id?.toLowerCase() === sourceId.toLowerCase());
  if (!book) throw new Error(`Livro não encontrado no catálogo: ${sourceId}`);
  const [volume, races, backgrounds, feats, items, optionalFeatures, classesIndex, classFoundry,
    raceFoundry, featFoundry, itemFoundry, optionalFoundry, spellFoundry, objects, vehicles, spellLookup] = await Promise.all([
      readJson(`book/book-${sourceId.toLowerCase()}.json`, {optional: true}),
      readJson("races.json", {optional: true}), readJson("backgrounds.json", {optional: true}),
      readJson("feats.json", {optional: true}), readJson("items.json", {optional: true}),
      readJson("optionalfeatures.json", {optional: true}), readJson("class/index.json", {optional: true}),
      readJson("class/foundry.json", {optional: true}), readJson("foundry-races.json", {optional: true}),
      readJson("foundry-feats.json", {optional: true}), readJson("foundry-items.json", {optional: true}),
      readJson("foundry-optionalfeatures.json", {optional: true}), readJson("spells/foundry.json", {optional: true}),
      readJson("objects.json", {optional: true}), readJson("vehicles.json", {optional: true}),
      readJson("generated/gendata-spell-source-lookup.json", {optional: true})
  ]);
  const isTarget = obj => obj?.source?.toLowerCase() === sourceId.toLowerCase();
  const records = {
    race: (races?.race ?? []).filter(isTarget),
    background: (backgrounds?.background ?? []).filter(isTarget),
    feat: (feats?.feat ?? []).filter(isTarget),
    item: (items?.item ?? []).filter(isTarget),
    optionalfeature: (optionalFeatures?.optionalfeature ?? []).filter(isTarget),
    object: (objects?.object ?? []).filter(isTarget),
    vehicle: (vehicles?.vehicle ?? []).filter(isTarget),
    class: [], subclass: [], classFeature: [], subclassFeature: [], spell: [], monster: []
  };
  const allClassFiles = [...new Set(Object.values(classesIndex || {}))];
  // The class index maps class names to files. Class features of the source may occur inside any of them.
  const classData = await Promise.all(allClassFiles.map(path => readJson(`class/${path}`, {optional: true})));
  for (const data of classData.filter(Boolean)) for (const key of ["class", "subclass", "classFeature", "subclassFeature"])
    records[key].push(...(data[key] ?? []).filter(isTarget));
  for (const data of await readSeries("spells/index.json", "spells", sourceId))
    records.spell.push(...(data.spell ?? []).filter(isTarget));
  for (const data of await readSeries("bestiary/index.json", "bestiary", sourceId))
    records.monster.push(...(data.monster ?? []).filter(isTarget));
  const foundry = {class: classFoundry, race: raceFoundry, feat: featFoundry,
    item: itemFoundry, optionalfeature: optionalFoundry, spell: spellFoundry};
  const chapters = volume?.bookData?.find(entry => entry.id?.toLowerCase() === sourceId.toLowerCase())?.data ?? [];
  return {book, sourceId, chapters, records, foundry, spellLookup,
    counts: Object.fromEntries(Object.entries(records).map(([key, val]) => [key, val.length]))};
}
