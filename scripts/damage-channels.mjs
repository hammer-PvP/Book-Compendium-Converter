import {plainText,textOf} from "./data-model.mjs";
const DAMAGE=/\b(acid|bludgeoning|cold|fire|force|lightning|necrotic|poison|psychic|radiant|slashing|thunder) damage\b/i;
/** Separate damage channels explicitly enumerated by source scaling metadata.
 * A movement/secondary roll is manual; it does not repeat casting consumption. */
export function addDamageChannels(record,system,kind,report){
  const tables=record.scalingLevelDice;
  if(kind==="spell"&&Number(record.level)===0&&Array.isArray(tables)&&tables.length>1){
    const activities=Object.values(system.activities??{});
    const metadata=tables.map(t=>channel(t,record));
    if(metadata.some(t=>!t)){report.incomplete.add(`${record.name}: multiple damage channels require explicit conversion`);return;}
    // Source definitions with multiple activities remain authoritative.
    if(activities.length>1)return;
    if(activities.length===1&&activities[0].type!=="damage"&& !activities[0].flags?.bcc?.generated){report.incomplete.add(`${record.name}: separate source damage channels are not represented by the supplemental activity`);return;}
    system.activities={};
    const primary=metadata.findIndex(c=>/on hit/i.test(c.name));
    const ordered=[...metadata.entries()].sort(([a],[b])=>Number(b===primary)-Number(a===primary));
    for(const [i,c] of ordered){
      const id=`bccDamage${String(i+1).padStart(7,"0")}`,followup=primary>=0?i!==primary:i>0;
      const inherited=Object.fromEntries(["target","range","visibility"].filter(k=>activities[0]?.[k]!=null).map(k=>[k,structuredClone(activities[0][k])]));
      system.activities[id]={...inherited,_id:id,name:c.name,type:"damage",damage:{critical:{allow:!followup&&primary>=0},parts:[c.part]},
        ...!followup&&activities[0]?.effects?{effects:structuredClone(activities[0].effects)}:{},
        ...(followup?{activation:{type:"",value:1,override:true,condition:c.name},consumption:{spellSlot:false,targets:[],scaling:{allowed:false}}}:{}),
        flags:{bcc:{damageChannel:c.name,sourceScaling:c.scaling,manualFollowup:followup}}};
    }
    report.information.add(`${record.name}: ${metadata.length} separate damage Activities from source scaling tables; follow-up rolls do not recast`);
  }
  if(!["classFeature","subclassFeature","feat","optionalfeature"].includes(kind))return;
  const raw=textOf(record.entries),text=plainText(record.entries);
  const base=/extra damage is \{@damage (\d+)d(\d+)\} for a (\d+)(?:st|nd|rd|th)-level spell slot, plus \{@damage (\d+)d\2\} for each spell level higher than \3(?:st|nd|rd|th), to a maximum of \{@damage (\d+)d\2\}/i.exec(raw);
  const conditional=/damage increases by \{@damage (\d+)d(\d+)\} if the target is (?:an? )?([^,.]+), to a maximum of \{@damage (\d+)d\2\}/i.exec(raw);
  const type=DAMAGE.exec(text)?.[1]?.toLowerCase();
  if(!base||!conditional||!type||base[2]!==conditional[2]||!text.includes("expend one spell slot"))return;
  const activities=Object.values(system.activities??{});if(activities.length>1)return;
  const [dice,die,slot,increment,cap]=base.slice(1).map(Number),bonus=Number(conditional[1]),conditionalCap=Number(conditional[4]);
  system.activities={};
  for(const [i,n] of [dice,dice+bonus].entries()){
    const id=`bccSlot${String(i+1).padStart(9,"0")}`;
    system.activities[id]={_id:id,name:i?`Damage — ${conditional[3]}`:record.name,type:"damage",activation:{type:"",value:1,condition:"After a qualifying weapon hit"},
      consumption:{spellSlot:false,scaling:{allowed:true,max:String(9-slot)},targets:[{type:"spellSlots",target:String(slot),value:"1",scaling:{mode:"level",formula:""}}]},
      damage:{critical:{allow:true},parts:[{types:[type],custom:{enabled:true,formula:`(min(${n} + @scaling * ${increment}, ${i?conditionalCap:cap}))d${die}`},scaling:{mode:"",number:0}}]},
      flags:{bcc:{damageAlternative:i?conditional[3]:"normal",baseSlot:slot,sourceDice:n,sourceCap:i?conditionalCap:cap}}};
  }
  report.information.add(`${record.name}: alternate damage and slot consumption derived from explicit source dice, increment and caps`);
}
function channel(table,record){
  const levels=[1,5,11,17],values=levels.map(l=>table.scaling?.[l]??(l===1?"0":null));if(values.some(v=>v==null)||!table.label)return null;
  const parsed=values.map(v=>/^(?:(\d+)d(\d+))?(?:\s*\+?\s*(\{\{spellcasting_mod\}\}))?$/.exec(String(v).trim())??(/^0$/.test(String(v))?["0",0,null,null]:null));
  if(parsed.some(p=>!p))return null;
  const dice=parsed.map(p=>Number(p[1]??0)),die=parsed.find(p=>p[2])?.[2],mod=parsed.map(p=>!!p[3]);
  if(!die||mod.some(m=>m!==mod[0]))return null;
  const step=dice[1]-dice[0];if(step<0||dice[2]-dice[1]!==step||dice[3]-dice[2]!==step)return null;
  const type=DAMAGE.exec(table.label)?.[1]?.toLowerCase()??(record.damageInflict?.length===1?record.damageInflict[0]:null);if(!type)return null;
  return {name:table.label,scaling:table.scaling,part:{number:dice[0],denomination:Number(die),bonus:mod[0]?"@mod":"",types:[type],scaling:{mode:"whole",number:step}}};
}
