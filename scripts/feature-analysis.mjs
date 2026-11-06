import {clone,plainText} from './data-model.mjs';
import {normalizeSpellRecipes,spellReplacementRules} from './spell-recipes.mjs';
const ABILITIES={intelligence:'int',wisdom:'wis',charisma:'cha',strength:'str',dexterity:'dex',constitution:'con'};
/** Bounded grammar shared by all feature categories. Supplements and source
 * structure take precedence; unsupported clauses remain coverage findings. */
export function analyzeFeature(record,{parent}={}){
  const out=normalizeSpellRecipes(clone(record)),text=plainText(record.entries),evidence=[],rules=spellReplacementRules(record.entries);
  if(rules.length){out._bccSpellReplacements=rules;if(!parent&&!record._bccSpellOnParent&&!out.additionalSpells?.length){const ability=Object.entries(ABILITIES).filter(([name])=>new RegExp(`\\b${name}\\b`,'i').test(text)).map(([,a])=>a);if(ability.length)out.additionalSpells=[{ability:ability.length===1?ability[0]:{choose:ability},known:{'1':rules.map(r=>r.initial)}}];}evidence.push('fixed-cantrip-with-rest-replacement');}
  if(!record._bccTraitsOnParent&&!record.skillProficiencies&&!record.toolProficiencies&&!record.skillToolLanguageProficiencies&&/\byou gain proficiency in (?:one|a) skill or with (?:one|a) tool of your choice\b/i.test(text)){
    out._bccTraitChoices=[{count:1,pool:['skills:*','tool:*'],replacement:/whenever you finish a long rest[^.]*replace it with another skill or tool proficiency/i.test(text)?'lr':null}];evidence.push('mixed-proficiency-choice');
  }
  out._bccMechanicEvidence=evidence;return out;
}
export function featureCoverage(record,system,adv,effects,report){
  const text=plainText(record.entries),pending=[];
  if(record._bccSpellReplacements?.length&&!record._bccSpellOnParent&&!Object.values(adv).some(a=>a.type==='ItemGrant'&&a.configuration?.spell))pending.push('initial cantrip grant lacks a supported casting-ability recipe');
  if(/\b(?:replace|exchange)\b/i.test(text)&&/\b(?:rest|finish|level)\b/i.test(text)&&!record._bccSpellReplacements?.length&&!record._bccTraitChoices?.some(c=>c.replacement))pending.push('timed replacement has no supported recipe');
  if(/\b(?:gain|have) proficiency\b/i.test(text)&&!Object.values(adv).some(a=>a.type==='Trait')&&!record._bccTraitsOnParent)pending.push('proficiency grant has no native Trait advancement');
  if(/\b(?:advantage|disadvantage)\b[^.]*\bsaving throws?\b/i.test(text)&&!effects.length)pending.push('conditional saving-throw advantage is descriptive; no effect automation');
  if(/finish\s+\{@dice\s+[^}]+\}\s+\{@variantrule\s+Long Rest/i.test(JSON.stringify(record.entries??[])))pending.push('random number of rests before recovery requires manual tracking');
  if(/\bbonus to (?:your )?(?:Armor Class|saving throws?)\b/i.test(text)&&!effects.length&&!Object.keys(system.activities??{}).length)pending.push('stated bonus has no supported effect or activity');
  for(const message of pending)report.incomplete.add(`${record.name}: ${message}`);
  report.featureCoverage??={analyzed:0,withPendingClauses:0,recognizedPatterns:{}};report.featureCoverage.analyzed++;if(pending.length)report.featureCoverage.withPendingClauses++;
  for(const pattern of record._bccMechanicEvidence??[])report.featureCoverage.recognizedPatterns[pattern]=(report.featureCoverage.recognizedPatterns[pattern]??0)+1;
  return {version:1,recognized:record._bccMechanicEvidence??[],representations:{activities:Object.keys(system.activities??{}).length,advancements:Object.keys(adv).length,effects:effects.length},pending};
}
