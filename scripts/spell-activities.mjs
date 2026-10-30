/**
 * 5etools spell data -> native D&D5e 6.x activity models.
 * Original BCC implementation. No Plutonium import, SRD fallback, network lookup,
 * runtime hooks, or name-specific spell rules.
 */
const ABILITY_NAMES = {strength:"str",dexterity:"dex",constitution:"con",intelligence:"int",wisdom:"wis",charisma:"cha"};
const DAMAGE_TYPES = ["acid","bludgeoning","cold","fire","force","lightning","necrotic","piercing","poison","psychic","radiant","slashing","thunder"];
const DICE_TAG = /\{@(damage|dice)\s+([^}|]+)(?:\|[^}]*)?\}/gi;
const SCALED_TAG = /\{@scaled(?:amage|ice)\s+([^}|]+)\|([^}|]+)\|([^}|]+)(?:\|[^}]*)?\}/gi;
const VALID_DIE = new Set([4,6,8,10,12,20,100]);
const lc = x => String(x??"").toLowerCase();
function textNodes(entries, output=[]) {
  if(typeof entries==="string") output.push(entries);
  else if(Array.isArray(entries)) for(const entry of entries) textNodes(entry,output);
  else if(entries && typeof entries==="object") {
    if(entries.type==="table") for(const row of entries.rows??[])textNodes(row,output);
    else textNodes(entries.entries??entries.entry??entries.items??entries.text??[],output);
  }
  return output;
}
function matches(text,regex) { return [...String(text).matchAll(regex)]; }
function firstFormula(text) {
  return matches(text,DICE_TAG).map(m=>m[2].trim()).find(f=>/\d+d\d+/i.test(f))??null;
}
function formulaToPart(formula,type,increment=null) {
  if(!formula)return null;
  const raw=formula.replace(/\s+/g," ").trim();
  const part={types:type?[type]:[]};
  const parsed=/^(\d+)d(\d+)(?:\s*([+-])\s*(\d+|@\w+))?$/i.exec(raw);
  if(parsed && VALID_DIE.has(Number(parsed[2]))){
    part.number=Number(parsed[1]);part.denomination=Number(parsed[2]);
    if(parsed[3])part.bonus=parsed[3]==="-"?`-${parsed[4]}`:parsed[4];
  } else {
    // Keep nonstandard formula literal. Validation will flag unrecognised syntax.
    if(!/^[\d@\w\s+\-*/().d]+$/i.test(raw))return null;
    part.custom={enabled:true,formula:raw};
  }
  if(increment){
    const s=/^(\d+)d(\d+)$/i.exec(increment);
    if(s && Number(s[2])===part.denomination){part.scaling={mode:"whole",number:Number(s[1]),formula:""};}
    else if(s)part.scaling={mode:"whole",number:0,formula:increment};
  }
  return part;
}
function scalingFormula(record,base) {
  if(Number(record.level)===0 && record.scalingLevelDice?.scaling){
    const values=record.scalingLevelDice.scaling;
    const at1=values["1"]??values["0"];
    const at5=values["5"];
    const a=/^(\d+)d(\d+)$/i.exec(String(at1??"")),b=/^(\d+)d(\d+)$/i.exec(String(at5??""));
    if(a && b && Number(a[2])===Number(b[2]) && Number(b[1])>Number(a[1]))
      return `${Number(b[1])-Number(a[1])}d${a[2]}`;
  }
  for(const line of textNodes(record.entriesHigherLevel)){
    const tag=matches(line,SCALED_TAG)[0];
    if(tag && lc(tag[1].replace(/\s/g,""))===lc(String(base).replace(/\s/g,"")))return tag[3].trim();
  }
  return null;
}
function damageType(record,lines) {
  const explicit=(record.damageInflict??[]).map(lc).filter(t=>DAMAGE_TYPES.includes(t));
  if(explicit.length===1)return explicit[0];
  // Multiple potential types: infer only when the text adjacent to the first damage tag is explicit.
  for(const line of lines){
    const match=matches(line,DICE_TAG)[0];if(!match)continue;
    const adjacent=line.slice(match.index+match[0].length,match.index+match[0].length+95).toLowerCase();
    const found=adjacent.match(new RegExp(`\\b(${DAMAGE_TYPES.join("|")})\\s+damage\\b`));
    if(found)return found[1];
  }
  return null;
}
function classifying(record,lines) {
  const all=lines.join(" ");
  const hasSave=Array.isArray(record.savingThrow)&&record.savingThrow.length>0;
  const hasAttack=Array.isArray(record.spellAttack)&&record.spellAttack.length>0;
  const looksLikeHeal=record.miscTags?.includes("HL") && /\b(regains?|restores?|heals?|hit points?)\b/i.test(all);
  const hasDamage=Array.isArray(record.damageInflict)&&record.damageInflict.length>0;
  if(hasSave)return "save";
  if(hasAttack)return "attack";
  if(looksLikeHeal)return "heal";
  if(hasDamage)return "damage";
  return "utility";
}
function activation(record){
  const item=record.time?.[0]??{};
  const valid={action:"action",bonus:"bonus",reaction:"reaction",minute:"minute",hour:"hour",day:"day"};
  return {type:valid[item.unit]??"special",value:item.number??1,...item.condition?{condition:item.condition}:{}};
}
function range(record){
  const r=record.range??{};const d=r.distance??{};
  if(["self","touch","sight","unlimited","special"].includes(d.type))return {units:d.type};
  const unit={feet:"ft",miles:"mi",meters:"m",kilometers:"km"}[d.type];
  if(unit)return {value:String(d.amount??""),units:unit};
  return {units:r.type==="point"?"special":"self"};
}
function duration(record){
  const d=record.duration?.[0]??{};
  if(d.type==="instant")return {units:"inst"};
  if(d.type==="permanent")return {units:"perm"};
  if(d.type==="timed" && d.duration){
    const units={round:"round",minute:"minute",hour:"hour",day:"day",week:"week",year:"year"}[d.duration.type];
    if(units)return {units,value:String(d.duration.amount??1)};
  }
  return {units:"spec"};
}
function target(record,lines){
  const r=record.range??{};const all=lines.join(" ");
  const shape={cone:"cone",cube:"cube",line:"line",radius:"sphere",sphere:"sphere",emanation:"emanation"};
  if(shape[r.type] && r.distance?.amount){
    return {template:{type:shape[r.type],size:String(r.distance.amount),units:r.distance.type==="feet"?"ft":"m"}};
  }
  const m=all.match(/\b(\d+)-foot(?:-radius)?\s+\{@variantrule\s+(sphere|cube|cone|cylinder|line|emanation)\b/i);
  if(m)return {template:{type:lc(m[2]),size:m[1],units:"ft"}};
  return {};
}
function spellBase(record){
  const comp=record.components??{}, material=comp.m;
  const properties=[];
  if(comp.v)properties.push("vocal");
  if(comp.s)properties.push("somatic");
  if(material)properties.push("material");
  if(record.meta?.ritual)properties.push("ritual");
  if(record.duration?.some(d=>d.concentration))properties.push("concentration");
  const materials=typeof material==="string"?{value:material}:material&&typeof material==="object"?
    {value:material.text??"",cost:Number(material.cost??0)/100,consumed:!!material.consume}:{};
  return {activation:activation(record),range:range(record),duration:duration(record),target:target(record,textNodes(record.entries)),materials,properties};
}
/** Return native spell fields plus possible Activity with explicit coverage diagnostics. */
export function synthesizeSpell(record){
  const lines=textNodes(record.entries);const base=spellBase(record);
  const issues=[];const name=record.name??"Spell";
  const kind=classifying(record,lines);
  const body=lines.join(" ");
  const damageFormula=firstFormula(body);
  const type=damageType(record,lines);
  const scaled=scalingFormula(record,damageFormula);
  const maybePart=damageFormula?formulaToPart(damageFormula,type,scaled):null;
  let parts=maybePart?[maybePart]:[];
  let activity={_id:"bccact0000000001",type:kind,name:kind==="utility"?"Cast":name,
    flags:{bcc:{generated:true,mechanicalBasis:"5etools-structured-data"}}};
  if(kind==="save"){
    const values=record.savingThrow.map(v=>ABILITY_NAMES[lc(v)]).filter(Boolean);
    if(!values.length){issues.push("savingThrow lists unrecognized ability; generated utility only");activity.type="utility";}
    else {
      const half=/(half as much damage|half the damage|takes half damage|takes half as much damage)/i.test(body);
      activity.save={ability:values,dc:{calculation:"spellcasting"}};
      activity.damage={onSave:half?"half":"none",parts};
      if(record.savingThrow.length>1)issues.push("multiple save abilities; verify alternatives");
    }
  }else if(kind==="attack"){
    const t=record.spellAttack.map(lc);
    activity.attack={type:{value:t.includes("r")?"ranged":"melee",classification:"spell"}};
    activity.damage={parts};
    if(t.length>1)issues.push("multiple attack modes; first mode selected");
  }else if(kind==="heal"){
    let formula=damageFormula;
    if(formula && /plus your spellcasting ability modifier/i.test(body))formula=`${formula} + @mod`;
    const healed=formulaToPart(formula,"healing",scalingFormula(record,damageFormula));
    if(healed)activity.healing=healed;
    else {
      activity.type="utility";
      activity.name="Cast";
      issues.push("healing formula not structurally resolved; utility Cast only");
    }
  }else if(kind==="damage"){
    if(parts.length)activity.damage={parts};
    else {
      activity.type="utility";
      activity.name="Cast";
      issues.push("damage dice/formula not structurally resolved; utility Cast only");
    }
  }
  if(["save","attack","damage"].includes(activity.type)&&record.damageInflict?.length&&!parts.length)
    issues.push("damageInflict present, but no safe damage dice/formula extracted");
  if(record.damageInflict?.length>1)issues.push("multiple damage types; verify every conditional type");
  if(damageFormula && record.damageInflict?.length && !type)issues.push("damage type not unambiguously resolved");
  const higher=textNodes(record.entriesHigherLevel).join(" ");
  if(higher && !scaled && (/\{@scaled|\bfor each spell slot level above\b/i.test(higher)))
    issues.push("higher-level scaling exists but was not modeled");
  if(record.level===0 && /\b(create|creates|launch|launches|fire|fires|make|makes)\s+(?:two|three|four|\d+)\s+(?:beams|rays|attacks|bolts|projectiles)\b/i.test(higher))
    issues.push("higher-level multiple attack/projectile count needs explicit roll-count model");
  if(activity.type==="utility" && kind==="utility"){
    if(record.miscTags?.includes("SMN"))issues.push("summoning requires Actor profiles/automation; utility Cast only");
    else if(record.miscTags?.includes("TP"))issues.push("teleportation execution is not automated; utility Cast only");
    else issues.push("utility Cast only; spell-specific narrative effects are not automated");
  }
  if(kind==="save"&&!activity.damage?.parts?.length&&record.conditionInflict?.length)
    issues.push("save recorded but conditions/effects require validation");
  if(record.conditionInflict?.length)issues.push("conditions in source require explicit Effects verification");
  if(record.miscTags?.includes("SMN") && kind!=="utility") issues.push("summoning side-effects require verification");
  return {system:base,activities:{[activity._id]:activity},issues,classification:activity.type};
}
