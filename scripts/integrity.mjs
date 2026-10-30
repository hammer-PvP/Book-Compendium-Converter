/** Fingerprint native persisted data, not a raw input blueprint with missing defaults. */
export async function contentHash(document) {
  const original = document.toObject ? document.toObject() : structuredClone(document);
  function stable(value) {
    if (value instanceof Set) return [...value].map(stable).sort();
    if (Array.isArray(value)) return value.map(stable);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.keys(value).sort().filter(k => !["_stats","contentHash","importedAt"].includes(k)).map(k => [k,stable(value[k])]));
  }
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(JSON.stringify(stable(original)))));
  return [...bytes].map(x => x.toString(16).padStart(2,"0")).join("");
}
export function auditReferences(documents,index,report) {
  const expected = new Set(index.all.map(e => e.uuid));
  for (const document of documents) {
    const value = JSON.stringify(document);
    for (const match of value.matchAll(/Compendium\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.(?:Item|Actor|JournalEntry)\.[A-Za-z0-9]{16}/g))
      if (!expected.has(match[0])) report.unresolved.add(`${document.name}: reference outside the generated graph ${match[0]}`);
  }
}
