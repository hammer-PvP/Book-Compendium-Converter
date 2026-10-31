import {normalizeSpellRecipes} from "./spell-recipes.mjs";
import {specialEquipmentReference} from "./equipment.mjs";
import {parseSpellFilter,matchesSpellMetadata} from "./spell-filter.mjs";
import {equipmentCategoryPool} from "./equipment.mjs";
import {attachedSpellRecipes} from "./item-spells.mjs";
import {createdResources} from "./created-resources.mjs";
import {readJson, getBooks} from "./source.mjs";
import {canonical as canon, clone, merge, identity, prepareRecords, attachSubraces, DEFAULT_SOURCES} from "./data-model.mjs";
const KINDS = ["race", "background", "feat", "item", "optionalfeature", "class", "subclass", "classFeature", "subclassFeature", "spell", "monster", "object", "vehicle"];
export function findSupplement(kind, record, foundry) {
  const file = ["class", "subclass", "classFeature", "subclassFeature"].includes(kind) ? foundry.class
    : ["race", "raceFeature"].includes(kind) ? foundry.race : foundry[kind];
  const fields = ["className", "classSource", "subclassShortName", "subclassSource", "raceName", "raceSource", "level"];
  const candidates = (file?.[kind] ?? []).filter(it => canon(it.name) === canon(record.name) && canon(it.source) === canon(record.source)
    && fields.every(k => it[k] == null || canon(it[k]) === canon(record[k])));
  return candidates.length === 1 ? candidates[0] : null;
}
function collectReferences(value, output = []) {
  if (typeof value === "string") {
    for (const m of value.matchAll(/\{@(spell|item|feat|optionalfeature)\s+([^}]+)\}/gi)) output.push([m[1].toLowerCase(), m[2]]);
    for (const m of value.matchAll(/@(spell|creature)\[([^\]]+)\]/gi)) output.push([m[1] === "creature" ? "monster" : "spell", m[2]]);
  } else if (Array.isArray(value)) value.forEach(x => collectReferences(x, output));
  else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) {
    if (k.startsWith("_bcc")) continue;
    if (["classFeature", "subclassFeature"].includes(k) && typeof v === "string") output.push([k, v]);
    if (k === "item" && typeof v === "string") output.push(["item", v]);
    collectReferences(v, output);
  }
  return output;
}
function matchesRequirements(record, conditions) {
  return Object.entries(conditions ?? {}).every(([key, expected]) => {
    const actual = record[key];
    return Array.isArray(expected) ? expected.some(x => Array.isArray(actual) ? actual.includes(x) : actual === x)
      : Array.isArray(actual) ? actual.includes(expected) : actual === expected;
  });
}
export async function readLibraryBook(id) {
  let sourceId = String(id).trim(); const books = await getBooks();
  const book = books.find(b => canon(b.id) === canon(sourceId));
  if (!book) throw Error(`Livro não encontrado no catálogo: ${sourceId}`);
  sourceId=book.id;
  const paths = ["races.json", "backgrounds.json", "feats.json", "items.json", "items-base.json", "magicvariants.json", "optionalfeatures.json", "objects.json", "vehicles.json", "class/index.json",
    "class/foundry.json", "foundry-races.json", "foundry-feats.json", "foundry-items.json", "foundry-optionalfeatures.json", "spells/foundry.json", "generated/gendata-spell-source-lookup.json", `book/book-${canon(sourceId)}.json`, "spells/index.json", "bestiary/index.json", "bestiary/legendarygroups.json", "bestiary/template.json"];
  const data = Object.fromEntries(await Promise.all(paths.map(async p => [p, await readJson(p, {optional: true})])));
  const raw = Object.fromEntries(KINDS.map(k => [k, []])), issues = [],sourceRules=new Map();
  const ruleOf=r=>r.edition==="one"||r.srd52||r.basicRules2024?"2024":r.edition==="classic"||r.srd||r.basicRules?"2014":null;
  for(const path of [...paths.slice(0,10),`book/book-${canon(sourceId)}.json`])if(!data[path])issues.push({category:"source",name:path,source:sourceId,message:"Local data file unavailable; related coverage is incomplete"});
  const addData = d => {for(const kind of KINDS)for(const r of d?.[kind]??[]){raw[kind].push(r);const rule=ruleOf(r);if(rule&&(rule==="2024"||!sourceRules.has(canon(r.source))))sourceRules.set(canon(r.source),rule);}};
  for (const path of paths.slice(0, 9)) addData(data[path]);
  raw.item.push(...(data["items-base.json"]?.baseitem ?? []).map(r=>({...r,_bccBaseEquipment:true})));
  for (const group of data["items.json"]?.itemGroup ?? []) raw.item.push({...clone(group), _bccGroupItems: clone(group.items ?? []), _bccIsGroup: true});
  for (const filename of new Set(Object.values(data["class/index.json"] ?? {}))) addData(await readJson(`class/${filename}`, {optional: true}));
  const foundry = {class: data["class/foundry.json"], race: data["foundry-races.json"], feat: data["foundry-feats.json"], item: data["foundry-items.json"], optionalfeature: data["foundry-optionalfeatures.json"], spell: data["spells/foundry.json"]};
  for (const file of Object.values(foundry)) if (file) for (const [kind, rows] of Object.entries(file))
    if (Array.isArray(rows)) file[kind] = prepareRecords(kind, rows, issues);
  const loaded = new Set();
  async function loadSeries(kind, source) {
    const folder = kind === "spell" ? "spells" : "bestiary", idx = data[`${folder}/index.json`] ?? {};
    const filename = Object.entries(idx).find(([s]) => canon(s) === canon(source))?.[1];
    if (!filename || loaded.has(`${folder}/${filename}`)) return;
    loaded.add(`${folder}/${filename}`);
    const body = await readJson(`${folder}/${filename}`, {optional: true}); addData(body);
    const dependencies = new Set([...Object.values(body?._meta?.dependencies ?? {}).flat(),...Object.values(body?._meta?.includes??{}).flat(),...Object.values(body?._meta?.otherSources??{}).flatMap(v=>Object.keys(v??{})), ...(body?.[kind] ?? []).map(r => r._copy?.source).filter(Boolean)]);
    for (const dependency of dependencies) await loadSeries(kind, dependency);
  }
  await Promise.all([loadSeries("spell", sourceId), loadSeries("monster", sourceId)]);
  const volume=data[`book/book-${canon(sourceId)}.json`],bookReferences=[];
  function scanBook(value){
    if(Array.isArray(value))value.forEach(scanBook);
    else if(value&&typeof value==="object"){
      const kind=({creature:"monster",monster:"monster",item:"item",spell:"spell",race:"race",feat:"feat",object:"object",vehicle:"vehicle"})[value.dataType??value.tag];
      if(value.type==="statblockInline"&&kind&&value.data?.name)addData({[kind]:[{...clone(value.data),source:value.data.source??sourceId,_bccInline:true}]});
      if(value.type==="statblock"&&kind&&value.name)bookReferences.push([kind,`${value.name}|${value.source??sourceId}`]);
      Object.values(value).forEach(scanBook);
    }else if(typeof value==="string")for(const m of value.matchAll(/\{@item\s+([^}]+)\}/gi))bookReferences.push(["item",m[1]]);
  }
  scanBook(volume);

  const prepared = {}, sizes = {};
  function catalog(kind) {
    if (sizes[kind] !== raw[kind].length) {
      prepared[kind] = prepareRecords(kind, raw[kind], issues,{templates:data["bestiary/template.json"]?.monsterTemplate??[]}); sizes[kind] = raw[kind].length;
      if (kind === "race") prepared[kind] = attachSubraces(prepared[kind], prepareRecords("race", data["races.json"]?.subrace ?? [], issues), issues);
    }
    return prepared[kind];
  }
  const bases = new Map();
  for (const item of data["items-base.json"]?.baseitem ?? []) {
    const key = canon(item.name); if (!bases.has(key) || canon(item.source) === canon(sourceId)) bases.set(key, item);
  }
  for (const variant of data["magicvariants.json"]?.magicvariant ?? []) {
    const inherit = variant.inherits ?? {}, source = inherit.source ?? variant.source;
    if (canon(source) !== canon(sourceId)) continue;
    for (const base of bases.values()) {
      if (!(variant.requires ?? []).some(r => matchesRequirements(base, r)) || (variant.excludes && matchesRequirements(base, variant.excludes))) continue;
      const out = merge(base, inherit);
      out.name = `${inherit.namePrefix ?? ""}${base.name}${inherit.nameSuffix ?? ""}`;
      out.source = source; out._bccBaseItem = `${base.name}|${base.source}`;
      out.entries = [...(base.entries ?? []), ...(inherit.entries ?? [])];
      delete out.namePrefix; delete out.nameSuffix; raw.item.push(out);
    }
  }
  const selected = new Map(), queue = [];
  const belongsToBook=r=>canon(r.source)===canon(sourceId)||(r.otherSources??[]).some(s=>canon(s.source)===canon(sourceId));
  const reasonFor=(owner,relation)=>`${owner.name}|${owner.source}: ${relation}`;
  function include(kind, record, dependency = false, reason = "explicit book reference") {
    if (!record) return;
    const key = identity(kind, record);
    if(selected.has(key)){const prior=selected.get(key).record;if(prior._bccDependency&&!prior._bccDependencyReasons.includes(reason))prior._bccDependencyReasons.push(reason);return;}
    const overlay = findSupplement(kind, record, foundry);
    const result = normalizeSpellRecipes(overlay?.entryData ? merge(record, overlay.entryData) : clone(record));
    result._bccDependency = dependency&&!belongsToBook(record); result._bccDependencyReasons=result._bccDependency?[reason]:[]; result._bccIgnored=!!overlay?.isIgnored;
    if(kind==="monster" && record.legendaryGroup)result._bccLegendary=(data["bestiary/legendarygroups.json"]?.legendaryGroup??[]).find(g=>canon(g.name)===canon(record.legendaryGroup.name)&&canon(g.source)===canon(record.legendaryGroup.source)); selected.set(key, {kind, record: result}); queue.push({kind, record: result});
    for (const [childKind, children] of Object.entries(overlay?.subEntities ?? {})) for (const child of children) {
      if (!raw[childKind]) { issues.push({category: kind, name: record.name, message: `Unsupported subentity ${childKind}`}); continue; }
      raw[childKind].push(child); include(childKind, child, true, reasonFor(record,"supplemental subentity"));
    }
  }
  for (const kind of KINDS) for (const record of catalog(kind)) if (canon(record.source) === canon(sourceId)||(record.otherSources??[]).some(s=>canon(s.source)===canon(sourceId))) include(kind, record);
  async function resolve(kind, uid, fallback, reason="explicit book reference") {
    if (!raw[kind]) return;
    const parts = String(uid).replace(/#.*$/,"").split("|"); let [name, source] = parts;
    if (kind === "classFeature") source = parts[4] || parts[2] || "PHB";
    if (kind === "subclassFeature") source = parts[6] || parts[4] || parts[2] || "PHB";
    source ||= DEFAULT_SOURCES[kind] ?? fallback;
    if (["spell", "monster"].includes(kind)) await loadSeries(kind, source);
    let candidates = catalog(kind).filter(r => canon(r.name) === canon(name.replace(/#.*$/, "")) && canon(r.source) === canon(source));
    if (!candidates.length && kind === "feat" && name.includes(";")) candidates = catalog(kind).filter(r => canon(r.name) === canon(name.split(";")[0]) && canon(r.source) === canon(source));
    const classSource=parts[2]||"PHB",subclassSource=parts[4]||classSource;
    const found = candidates.find(r => kind === "classFeature" ? canon(r.className) === canon(parts[1]) && canon(r.classSource) === canon(classSource) && Number(r.level) === Number(parts[3])
      : kind === "subclassFeature" ? canon(r.className) === canon(parts[1]) && canon(r.classSource) === canon(classSource) && canon(r.subclassShortName) === canon(parts[3]) && canon(r.subclassSource) === canon(subclassSource) && Number(r.level) === Number(parts[5]) : true);
    include(kind, found, true,reason);
  }
  for(const [kind,uid] of bookReferences)await resolve(kind,uid,sourceId);
  const lookup = data["generated/gendata-spell-source-lookup.json"], recipeCache=new Map();
  for (let pos = 0; pos < queue.length; pos++) {
    if (queue.length > 15000) throw Error("Grafo de dependências excedeu o limite de 15000 entidades.");
    const {kind, record} = queue[pos], refs = [];
    if(kind!=="item")for(const resource of createdResources(record)){
      const exists=catalog("item").find(r=>canon(r.name)===canon(resource.name)&&canon(r.source)===canon(resource.source));
      include("item",exists??resource,true,reasonFor(record,"named resource created by source rule"));
    }
    // Narrative links are rendered when available; they do not expand publication scope.
    // Native activity references and structured mechanical fields are mandatory.
    const mechanical={...record};for(const key of ["entries","fluff","additionalEntries","startingEquipment"])delete mechanical[key];
    collectReferences(mechanical,refs);
    function featureReferences(v){
      if(Array.isArray(v))v.forEach(featureReferences);
      else if(v&&typeof v==="object"){
        for(const key of ["classFeature","subclassFeature","optionalfeature"])if(typeof v[key]==="string")refs.push([key,v[key]]);
        Object.values(v).forEach(featureReferences);
      }
    }
    featureReferences(record.entries);
    if(record.startingEquipment){
      // Open categories may use this publication, its explicit parent, and one
      // rules-compatible base-equipment catalog, never every loaded supplement.
      const rules=ruleOf(record)??sourceRules.get(canon(record.source));
      const baseSources=new Map();
      for(const item of catalog("item"))if(item._bccBaseEquipment&&(!rules||(ruleOf(item)??sourceRules.get(canon(item.source)))===rules))baseSources.set(item.source,(baseSources.get(item.source)??0)+1);
      const baseSource=[...baseSources].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]))[0]?.[0];
      record._bccEquipmentSources=[...new Set([sourceId,record.source,record.classSource,baseSource].filter(Boolean))];
      const categories=new Set();
      function scan(v){if(typeof v==="string"){refs.push(["item",v]);return;}if(Array.isArray(v))v.forEach(scan);else if(v&&typeof v==="object"){if(v.equipmentType)categories.add(v.equipmentType);for(const type of v.equipmentTypes??[])categories.add(type);
          if(v.item)refs.push(["item",v.item]);if(v.special){const ref=specialEquipmentReference(v.special,catalog("item"),record);if(ref)refs.push(["item",ref]);}Object.values(v).forEach(scan);}}
      scan(record.startingEquipment.defaultData??record.startingEquipment);
      for(const category of categories)for(const item of equipmentCategoryPool(catalog("item"),category,{...record,_bccRules:ruleOf(record)??sourceRules.get(canon(record.source))}))include("item",item,true,reasonFor(record,`starting equipment category ${category}`));
    }
    for(const spec of attachedSpellRecipes(record))refs.push(["spell",spec.uid]);
    for(const value of [...(record.attachedItems??[]),...(record.gear??[])])refs.push(["item",typeof value==="string"?value:value.item??value.name]);
    collectReferences(findSupplement(kind, record, foundry), refs);
    if (kind === "class" || kind === "subclass") {
      for (const ref of record[kind === "class" ? "classFeatures" : "subclassFeatures"] ?? []) if (typeof ref === "string") refs.push([kind === "class" ? "classFeature" : "subclassFeature", ref]);
      for (const step of record.optionalfeatureProgression ?? []) {
        const local = catalog("optionalfeature").filter(r => (belongsToBook(r)||canon(r.source)===canon(record.source))&&(r.featureType ?? []).some(t => step.featureType?.includes(t)));
        for (const option of local) include("optionalfeature", option, true,reasonFor(record,"feature selector in book or required parent class"));
      }
      for (const step of record.featProgression ?? []) for (const feat of catalog("feat")) if ((belongsToBook(feat)||canon(feat.source)===canon(record.source))&&step.category?.includes(feat.category)) include("feat", feat, true,reasonFor(record,"feat selector in book or required parent class"));
      if (kind === "subclass") await resolve("class", `${record.className}|${record.classSource}`, record.source,reasonFor(record,"required parent class"));
      const name = kind === "class" ? record.name : record.className, source = kind === "class" ? record.source : record.classSource;
      const memberships=Object.entries(lookup??{}).map(([src,spells])=>[src,Object.entries(spells).filter(([,lists])=>Object.entries(lists.class??{}).some(([s,classes])=>canon(s)===canon(source)&&Object.keys(classes).some(n=>canon(n)===canon(name))))]);
      const allowed=new Set([canon(sourceId),canon(source)]);
      // A supplemental class may declare a core spell list without publishing spells itself.
      // Select a single rules-compatible base catalog, never every supplement in the lookup.
      {
        const rules=ruleOf(record)??sourceRules.get(canon(record.source));
        const base=memberships.filter(([src,rows])=>rows.length&&sourceRules.get(canon(src))===rules).sort((a,b)=>b[1].length-a[1].length||a[0].localeCompare(b[0]))[0];
        if(base)allowed.add(canon(base[0]));
      }
      for(const [src,spells] of memberships)if(allowed.has(canon(src)))for(const [spellName] of spells)await resolve("spell",`${spellName}|${src}`,record.source,reasonFor(record,"declared class spell list"));
    }
    for (const featSet of record.feats ?? []) for (const [feat,value] of Object.entries(featSet)){
      if(feat==="any"||feat==="anyFromCategory"){for(const candidate of catalog("feat"))if(belongsToBook(candidate)&&(feat==="any"||value.category?.includes(candidate.category)))include("feat",candidate,true,reasonFor(record,"feat selector in book or required parent class"));}
      else refs.push(["feat",feat]);
    }
    const selectors=new Set();
    function recipeFilters(v){
      if(Array.isArray(v))v.forEach(recipeFilters);
      else if(v&&typeof v==="object"){
        const filter=typeof v.choose==="string"?v.choose:typeof v.all==="string"?v.all:null;
        if(filter)selectors.add(filter);
        if(v.choose?.from)for(const uid of v.choose.from)refs.push(["spell",uid]);
        Object.values(v).forEach(recipeFilters);
      }
    }
    recipeFilters(record.additionalSpells);
    for(const filter of selectors){
      if(!recipeCache.has(filter)){
        const parsed=parseSpellFilter(filter),matches=[];
        if(parsed)for(const [src,spellEntries] of Object.entries(lookup??{})){
          if(canon(src)!==canon(sourceId))continue;
          const names=new Set(Object.entries(spellEntries).filter(([,lists])=>!parsed.classes||Object.values(lists.class??{}).some(group=>Object.keys(group).some(n=>parsed.classes.includes(canon(n))))).map(([name])=>canon(name)));
          if(!names.size)continue;await loadSeries("spell",src);
          for(const candidate of catalog("spell"))if(canon(candidate.source)===canon(src)&&names.has(canon(candidate.name))&&matchesSpellMetadata(candidate,parsed))matches.push(["spell",`${candidate.name}|${candidate.source}`]);
        }
        recipeCache.set(filter,matches);
      }
      refs.push(...recipeCache.get(filter));
    }
    for (const member of [...(record._bccGroupItems??[]),...(record.packContents??[])]) refs.push(["item", typeof member === "string" ? member : member.item]);
    function spells(v) {
      if (typeof v === "string" && !/[=<>]/.test(v)) refs.push(["spell", v.replace(/#.*$/, "")]);
      else if (Array.isArray(v)) v.forEach(spells);
      else if (v && typeof v === "object") for (const [key, val] of Object.entries(v)) if (!["name", "ability", "choose", "resourceName"].includes(key)) spells(val);
    }
    spells(record.additionalSpells);
    if(kind==="spell"&&record.miscTags?.includes("SMN")){
      for(const match of JSON.stringify(record.entries??[]).matchAll(/\{@creature\s+([^}]+)\}/gi))refs.push(["monster",match[1]]);
    }
    if (kind === "monster") spells(record.spellcasting?.map(s => ({spells: s.spells, will: s.will, daily: s.daily, rest: s.rest, constant: s.constant,ritual:s.ritual,weekly:s.weekly})));
    for (const [refKind, uid] of refs) if (uid) await resolve(refKind, uid, record.source,reasonFor(record,"explicit mechanical reference"));
  }
  const records = Object.fromEntries(KINDS.map(kind => [kind, [...selected.values()].filter(x => x.kind === kind).map(x => x.record)]));
  for(const rows of Object.values(records))for(const r of rows)r._bccRules=(r.classSource?sourceRules.get(canon(r.classSource)):null)??ruleOf(r)??sourceRules.get(canon(r.source))??null;
  const chapters = volume?.bookData?.find(e => canon(e.id) === canon(sourceId))?.data ?? [];
  return {book, sourceId, chapters, records, foundry, spellLookup: lookup,proficiencyItems:Object.fromEntries(catalog("item").map(r=>[canon(r.name).replace(/[^a-z0-9]/g,""),{name:r.name,type:r.type,weaponCategory:r.weaponCategory,property:r.property??[],source:r.source}])),
    preparationIssues: [...new Map(issues.filter(i=>canon(i.source)===canon(sourceId)||[...selected.values()].some(e=>e.kind===i.category&&canon(e.record.name)===canon(i.name)&&canon(e.record.source)===canon(i.source))).map(i => [JSON.stringify(i), i])).values()],
    dependencyReasons:[...selected.values()].filter(e=>e.record._bccDependency).map(e=>({kind:e.kind,name:e.record.name,source:e.record.source,reasons:e.record._bccDependencyReasons})),
    dependencies: Object.fromEntries(KINDS.map(k => [k, records[k].filter(r => r._bccDependency).length])),
    counts: Object.fromEntries(KINDS.map(k => [k, records[k].length]))};
}
