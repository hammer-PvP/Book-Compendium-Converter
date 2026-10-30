import {clone, canonical as lc, plainText} from "./data-model.mjs";
import {availableLevel} from "./feature-mechanics.mjs";
/** Project only variants which change named features and leave every other species field intact. */
export function speciesGraph(input) {
  const races = input.map(clone), features = [], projected = new Set();
  function hasChoice(value){return Array.isArray(value)?value.some(hasChoice):value&&typeof value==="object"?("choose" in value||Object.entries(value).some(([k,v])=>/^any(?:[A-Z]|$)/.test(k)||hasChoice(v))):false;}
  const structural = r => JSON.stringify(Object.fromEntries(Object.entries(r).filter(([k]) => !k.startsWith("_") && !["name","entries","source"].includes(k))));
  for (const base of races.filter(r => !r._bccVariantOf)) {
    const variants = races.filter(r => lc(r._bccVariantOf?.name) === lc(base.name) && lc(r._bccVariantOf?.source) === lc(base.source));
    const groups = new Map(); let safe = variants.length > 1;
    for (const v of variants) {
      if (structural(v) !== structural(base) || v.entries?.length !== base.entries?.length) { safe = false; break; }
      const changed = (v.entries ?? []).map((e,i) => ({entry:e,base:base.entries[i],i})).filter(x => JSON.stringify(x.entry) !== JSON.stringify(x.base));
      if (changed.length !== 1 || !changed[0].entry.name || !changed[0].base.name) {safe = false;break;}
      const {entry,i} = changed[0];
      if (!groups.has(i)) groups.set(i,[]);
      groups.get(i).push({variant:v,entry});
    }
    if (!safe || groups.size !== 1) {
      const fields=Object.keys(base).filter(k=>!k.startsWith("_")&&!["name","source","entries"].includes(k));
      if(variants.length>1&&fields.some(k=>hasChoice(base[k])&&variants.some(v=>JSON.stringify(v[k])!==JSON.stringify(base[k]))))base._bccSpeciesTemplate=true;
      continue;
    }
    const [position, alternatives] = [...groups][0];
    const template = base.entries[position];
    base._bccChoices = [{name:template.name,names:alternatives.map(x => x.entry.name),level:availableLevel({entries:template.entries})}];
    template._bccChoiceTemplate = true;
    // Preserve the common resource/usage paragraphs while replacing the list of mutually exclusive options.
    const intro = (template.entries ?? []).filter(e => typeof e === "string");
    for (const {variant,entry} of alternatives) {
      projected.add(variant);
      features.push({name:entry.name,source:base.source,page:base.page,edition:base.edition,raceName:base.name,raceSource:base.source,
        entries:[...clone(intro),...clone(entry.entries ?? [])],_bccOption:true,_bccDependency:base._bccDependency});
    }
  }
  const retained = races.filter(r => !projected.has(r));
  for (const race of retained) for (const entry of race.entries ?? []) if (entry?.name && Array.isArray(entry.entries) && ["entries","section"].includes(entry.type)) {
    features.push({name:entry.name,source:race.source,page:race.page,edition:race.edition,raceName:race.name,raceSource:race.source,entries:clone(entry.entries),
      _bccChoiceTemplate:!!entry._bccChoiceTemplate,_bccGrantLevel:availableLevel(entry),_bccDependency:race._bccDependency,_bccIgnored:!!race._bccSpeciesTemplate});
  }
  return {races:retained,features};
}
