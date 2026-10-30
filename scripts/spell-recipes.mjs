import {clone,textOf,plainText,canonical} from "./data-model.mjs";
const normalizeFilter=value=>String(value).toLowerCase().split("|").map(v=>v.trim()).sort().join("|");
/** Recognize explicit initial grants followed by a separately timed replacement. */
export function normalizeSpellRecipes(record){
  if(!record.additionalSpells)return record;
  const raw=textOf(record.entries),rules=[];
  for(const match of raw.matchAll(/you (?:also )?know the \{@spell\s+([^}]+)\} cantrip\.([\s\S]{0,650})/gi)){
    const tail=match[2],text=plainText(tail),filter=/\{@filter\s+[^|}]+\|spells\|([^}]+)\}/i.exec(tail)?.[1];
    if(filter&&/whenever you finish a long rest/i.test(text)&&/replace (?:that|this) cantrip/i.test(text))rules.push({initial:match[1],timing:"lr",filter});
  }
  if(!rules.length)return record;
  const result=clone(record),applied=[];
  function visit(value,level=0){
    if(Array.isArray(value))return value.map(v=>visit(v,level));
    if(!value||typeof value!=="object")return value;
    if(typeof value.choose==="string"&&Number(value.count??1)===1&&level<=1){
      const rule=rules.find(r=>normalizeFilter(r.filter)===normalizeFilter(value.choose));
      if(rule){applied.push(rule);return rule.initial;}
    }
    return Object.fromEntries(Object.entries(value).map(([key,v])=>[key,visit(v,/^\d+$/.test(key)?Number(key):level)]));
  }
  for(const block of result.additionalSpells)if(block.known)block.known=visit(block.known);
  if(applied.length)result._bccSpellReplacements=[...new Map(applied.map(r=>[canonical(r.initial),r])).values()];
  return result;
}
