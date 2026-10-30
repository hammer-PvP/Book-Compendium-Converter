import {canonical as lc} from "./data-model.mjs";
import {nativeKey} from "./native-keys.mjs";
const SKILLS = {acrobatics:"acr","animal handling":"ani",arcana:"arc",athletics:"ath",deception:"dec",history:"his",insight:"ins",intimidation:"itm",investigation:"inv",medicine:"med",nature:"nat",perception:"prc",performance:"prf",persuasion:"per",religion:"rel","sleight of hand":"slt",stealth:"ste",survival:"sur"};
const list = v => Array.isArray(v) ? v : v ? [v] : [];
const normalized=name=>lc(String(name).split("|")[0]).replace(/[^a-z0-9]/g,"");
export function languageKey(name) {
  const wanted=normalized(name),matches=[],partial=[];
  const words=lc(name).split(/[^a-z0-9]+/).filter(Boolean);
  function visit(tree,path=[]){for(const [key,value] of Object.entries(tree??{})){
    const next=[...path,key],label=typeof value==="string"?value:value.label;
    if(value?.selectable!==false){
      if(normalized(key)===wanted||normalized(String(label).split(".").at(-1))===wanted)matches.push(next.join(":"));
      const position=words.lastIndexOf(normalized(key));if(position>=0)partial.push({path:next.join(":"),position});
    }
    if(value?.children)visit(value.children,next);
  }}
  visit(globalThis.CONFIG?.DND5E?.languages);
  if(matches.length===1)return matches[0];
  const candidates=partial.filter(x=>x.position===Math.max(...partial.map(x=>x.position)));
  return candidates.length===1?candidates[0].path:null;
}
function toolKey(name,index) {
  const match=nativeKey("tool",name);if(!match)return null;
  const metadata=index?.proficiencyItems?.[normalized(name)],category={AT:"art",GS:"game",INS:"music"}[String(metadata?.type??"").split("|")[0]]??match.category;
  return ["art","game","music"].includes(category)?`${category}:${match.key}`:match.key;
}
export function applyNativeTraits(record, adv, add, report,index) {
  function specific(name,trait){
    const metadata=index?.proficiencyItems?.[normalized(name)];
    if(!metadata)return null;
    const key=nativeKey(trait,name)?.key;if(!key)return null;
    const category=trait==="weapon"?(metadata.weaponCategory==="martial"?"mar":"sim"):{LA:"lgt",MA:"med",HA:"hvy",S:"shl"}[String(metadata.type).split("|")[0]];
    return category?`${category}:${key}`:null;
  }
  function weaponFilter(filter){
    const properties={light:"L",finesse:"F","two-handed":"2H",thrown:"T",versatile:"V",heavy:"H",reach:"R",ammunition:"A",loading:"LD"};
    const clauses=String(filter).toLowerCase().split("|").map(x=>x.split("="));
    if(clauses.some(([key])=>!["type","property","rarity"].includes(key))){report.incomplete.add(`${record.name}: unsupported proficiency filter ${filter}`);return [];}
    const names=Object.values(index?.proficiencyItems??{}).filter(r=>{
      const type=String(r.type).split("|")[0];if(!["M","R"].includes(type))return false;
      return clauses.every(([key,value])=>{
        const options=value.split(";");
        if(key==="type")return options.some(v=>({"martial weapon":r.weaponCategory==="martial","simple weapon":r.weaponCategory==="simple","melee weapon":type==="M","ranged weapon":type==="R"})[v]);
        if(key==="rarity")return value==="none";
        return options.some(v=>{const neg=v.startsWith("!"),code=properties[neg?v.slice(1):v];return code&&(neg?!(r.property??[]).includes(code):(r.property??[]).includes(code));});
      });
    });
    return [...new Set(names.map(r=>specific(r.name,"weapon")).filter(Boolean).map(k=>`weapon:${k}`))];
  }
  function traits(title, field, category, map) {
    const grants = new Set(), choices = [];
    const convert = name => {const key = map?.(lc(name));return key ? `${category}:${key}` : null;};
    for (const block of list(record[field])) {
      if (typeof block === "string") {const key = convert(block);if (key)grants.add(key);else report.incomplete.add(`${record.name}: unresolved ${category} ${block}`);continue;}
      if (!block || typeof block !== "object") continue;
      for (const [key,value] of Object.entries(block)) if (value === true) {const native = convert(key);if (native) grants.add(native);else report.incomplete.add(`${record.name}: unresolved ${category} ${key}`);}
      for (const [key,count] of Object.entries(block)) if (/^any/.test(key) && Number.isFinite(Number(count))) {
        const subset=({anyStandard:"standard",anyArtisansTool:"art",anyGamingSet:"game",anyMusicalInstrument:"music"})[key];
        choices.push({count:Number(count),pool:[`${category}:${subset?`${subset}:`:""}*`]});
      }
      if(category==="weapon"&&block.all?.fromFilter){const pool=weaponFilter(block.all.fromFilter);for(const key of pool)grants.add(key);if(!pool.length)report.incomplete.add(`${record.name}: empty proficiency filter ${block.all.fromFilter}`);}
      if(category==="weapon"&&block.choose?.fromFilter){const pool=weaponFilter(block.choose.fromFilter);if(pool.length)choices.push({count:Number(block.choose.count??1),pool});else report.incomplete.add(`${record.name}: empty proficiency choice ${block.choose.fromFilter}`);}
      for (const choice of list(block.choose)) if (Array.isArray(choice?.from)) {
        const pool = choice.from.map(convert).filter(Boolean);
        if (pool.length) choices.push({count:Number(choice.count ?? 1),pool});
        if (pool.length !== choice.from.length) report.incomplete.add(`${record.name}: incomplete ${category} choice pool`);
      }
    }
    if (grants.size || choices.length) add(adv,{type:"Trait",name:title,level:Number(record._bccGrantLevel ?? 0),configuration:{mode:"default",allowReplacements:false,grants:[...grants],choices},value:{}});
  }
  traits("Skill Proficiencies","skillProficiencies","skills",s => SKILLS[s]);
  traits("Languages","languageProficiencies","languages",languageKey);
  traits("Tool Proficiencies",record.toolProficiencies?"toolProficiencies":"tools","tool",s=>toolKey(s,index));
  traits("Armor Proficiencies",record.armorProficiencies?"armorProficiencies":"armor","armor",s => ({light:"lgt",medium:"med",heavy:"hvy",shield:"shl"}[s]??specific(s,"armor")));
  traits("Weapon Proficiencies","weaponProficiencies","weapon",s => ({simple:"sim",martial:"mar"}[s]??specific(s,"weapon")));
  for (const [field,category,title] of [["resist","dr","Damage Resistances"],["immune","di","Damage Immunities"],["vulnerable","dv","Damage Vulnerabilities"],["conditionImmune","ci","Condition Immunities"]]) {
    const grants = list(record[field]).filter(x => typeof x === "string").map(x => `${category}:${lc(x)}`);
    if (grants.length) add(adv,{type:"Trait",name:title,level:0,configuration:{mode:"default",allowReplacements:false,grants,choices:[]},value:{}});
    const selections=list(record[field]).filter(x=>x?.choose?.from);
    if(selections.length)add(adv,{type:"Trait",name:title,level:0,configuration:{mode:"default",allowReplacements:false,grants:[],choices:selections.map(x=>({count:Number(x.choose.count??1),pool:x.choose.from.map(s=>`${category}:${lc(s)}`)}))},value:{}});
    if (list(record[field]).some(x => typeof x !== "string"&&!x?.choose?.from)) report.incomplete.add(`${record.name}: conditional ${field} requires explicit choice/condition conversion`);
  }
  if (record.weapons?.length) traits("Weapon Proficiencies","weapons","weapon",s => ({simple:"sim",martial:"mar"}[s]??specific(s,"weapon")));
}
