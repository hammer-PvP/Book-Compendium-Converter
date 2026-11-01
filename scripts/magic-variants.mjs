const canon=v=>String(v??'').toLowerCase().trim();
export const equipmentRules=r=>r._bccRules??(r.edition==='one'||r.srd52||r.basicRules2024?'2024':r.edition==='classic'||r.srd||r.basicRules?'2014':null);
export function matchesRequirements(record,conditions){return Object.entries(conditions??{}).every(([key,expected])=>{const actual=record[key];return Array.isArray(expected)?expected.some(x=>Array.isArray(actual)?actual.includes(x):actual===x):Array.isArray(actual)?actual.includes(expected):actual===expected;});}
/** Filter source-qualified requirements before choosing equivalent bases. */
export function variantBases(all,variant,source,rules){
  const candidates=all.filter(base=>(variant.requires??[]).some(r=>matchesRequirements(base,r))&&!(variant.excludes&&matchesRequirements(base,variant.excludes)));
  const groups=new Map();for(const base of candidates){const k=canon(base.name);if(!groups.has(k))groups.set(k,[]);groups.get(k).push(base);}
  const score=b=>(canon(b.source)===canon(source)?8:0)+(rules&&equipmentRules(b)===rules?4:0);
  return [...groups.values()].map(rows=>rows.sort((a,b)=>score(b)-score(a)||String(a.source).localeCompare(String(b.source)))[0]);
}
