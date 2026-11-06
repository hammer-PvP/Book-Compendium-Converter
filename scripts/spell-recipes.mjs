import {clone,textOf,plainText,canonical} from "./data-model.mjs";
const normalizeFilter=value=>String(value).toLowerCase().split('|').map(v=>{const [k,...parts]=v.trim().split('=');return `${k}=${parts.join('=').split(';').map(s=>s.trim()).sort().join(';')}`;}).sort().join('|');
export function spellReplacementRules(entries){
  const scopes=[],rules=[];function scope(value){const list=Array.isArray(value)?value:[value],local=[];for(const entry of list){if(entry&&typeof entry==='object'&&entry.name&&entry.entries)scope(entry.entries);else local.push(entry);}const text=textOf(local);if(text)scopes.push(text);}scope(entries);
  for(const raw of scopes)for(const match of raw.matchAll(/you (?:also )?know the \{@spell\s+([^}]+)\} cantrip\.([^]*?)(?=you (?:also )?know the \{@spell|$)/gi)){
    const tail=match[2].slice(0,900),text=plainText(tail);let filter=/\{@filter\s+[^|}]+\|spells\|([^}]+)\}/i.exec(tail)?.[1];
    if(!filter){const lists=/different cantrip from (?:the )?([A-Za-z ,;-]{1,160}) spell lists?/i.exec(text)?.[1],classes=lists?.split(/,|;|\bor\b|\band\b/i).map(s=>s.trim()).filter(Boolean);if(classes?.length&&classes.every(c=>/^[A-Za-z][A-Za-z ]{0,35}$/.test(c)))filter=`level=0|class=${classes.join(';')}`;}
    if(filter&&/whenever you finish a long rest/i.test(text)&&/replace (?:that|this) cantrip/i.test(text))rules.push({initial:match[1],timing:'lr',filter});
  }return rules;
}
/** Recognize explicit initial grants followed by a separately timed replacement. */
export function normalizeSpellRecipes(record){
  if(!record.additionalSpells)return record;
  const rules=spellReplacementRules(record.entries);
  if(!rules.length)return record;
  const result=clone(record),applied=[];
  function visit(value,level=0){
    if(Array.isArray(value))return value.map(v=>visit(v,level));
    if(!value||typeof value!=="object")return value;
    if(typeof value.choose==="string"&&Number(value.count??1)===1&&level<=1){
      const matching=rules.filter(r=>normalizeFilter(r.filter)===normalizeFilter(value.choose));
      if(matching.length===1){applied.push(matching[0]);return matching[0].initial;}
    }
    return Object.fromEntries(Object.entries(value).map(([key,v])=>[key,visit(v,/^\d+$/.test(key)?Number(key):level)]));
  }
  for(const block of result.additionalSpells)if(block.known)block.known=visit(block.known);
  if(applied.length)result._bccSpellReplacements=[...new Map(applied.map(r=>[canonical(r.initial),r])).values()];
  return result;
}
