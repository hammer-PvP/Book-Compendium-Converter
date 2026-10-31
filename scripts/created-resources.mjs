import {plainText,clone,canonical} from "./data-model.mjs";
import {AUXILIARY_TYPES} from "./icon-catalog.mjs";
const slug=v=>String(v).normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");
/** Materialize only a named, physical resource explicitly created by the source.
 * This does not grant a second object or impose an acquisition Advancement.
 */
export function createdResources(record){
  if(record._bccCreatedResource)return [];
  const text=plainText(record.entries),creation=/\b(?:conjure|create|summon)\b[^.!?]{0,140}\b(?:a|an) ([a-z]+)\b[^.!?]{0,180}\b(?:at|by) the end of\b[^.!?]{0,90}\brest\b/i.exec(text);
  if(!creation)return [];
  const noun=creation[1],capital=noun[0].toUpperCase()+noun.slice(1);
  const named=new RegExp(`\\b(?:This|The|Your) (${capital}(?: (?:of|the|and|[A-Z][A-Za-z’'-]*)){1,7})\\b`).exec(text);
  if(!named)return [];
  const name=named[1],identifier=slug(name),focus=/\b(?:use|serves?|functions?)\b[^.!?]{0,100}\bspellcasting focus\b/i.test(text);
  const nativeType=AUXILIARY_TYPES[identifier]??(focus?"equipment":"loot");
  const periods=[...(/short(?:\s+or\s+long)?\s+rest/i.test(text)?["sr"]:[]),...(/long(?:\s+or\s+short)?\s+rest/i.test(text)?["lr"]:[])];
  return [{name,source:record.source,page:record.page,edition:record.edition,_bccRules:record._bccRules,
    type:focus?"SCF":"G",foundryType:nativeType,entries:clone(record.entries),
    _bccCreatedResource:{owner:{name:record.name,source:record.source},identifier,focus,periods}}];
}
export function createdResourceLinks(record,index){
  return index.all.filter(e=>e.kind==="item"&&e.record._bccCreatedResource&&canonical(e.record._bccCreatedResource.owner.name)===canonical(record.name)&&canonical(e.record._bccCreatedResource.owner.source)===canonical(record.source))
    .map(e=>({uuid:e.uuid,identifier:e.record._bccCreatedResource.identifier,timing:e.record._bccCreatedResource.periods,grant:"consumer-managed"}));
}
