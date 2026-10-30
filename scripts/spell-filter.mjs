const SCHOOLS={abjuration:"a",conjuration:"c",divination:"d",enchantment:"e",evocation:"v",illusion:"i",necromancy:"n",transmutation:"t"};
export function parseSpellFilter(filter){
  const fields=Object.fromEntries(String(filter).split("|").map(p=>{const [k,v]=p.split(/=(.*)/s);return [k.trim().toLowerCase(),v?.trim()];}));
  if(Object.keys(fields).some(k=>!["level","class","school","components & miscellaneous"].includes(k))||Object.values(fields).some(v=>!v))return null;
  const miscellaneous=fields["components & miscellaneous"]?.split(";").map(s=>s.trim().toLowerCase());
  if(miscellaneous?.some(s=>s!=="ritual"))return null;
  let levels=null;
  if(fields.level){levels=new Set();for(const expression of fields.level.split(";")){
    if(!/^\d+(?:~\d+)?$/.test(expression))return null;
    const [a,b=a]=expression.split("~").map(Number);if(a<0||b>9||b<a)return null;
    for(let n=a;n<=b;n++)levels.add(n);
  }}
  return {levels,ritual:miscellaneous?.includes("ritual"),classes:fields.class?.split(";").map(s=>s.trim().toLowerCase()),schools:fields.school?.split(";").map(s=>SCHOOLS[s.toLowerCase()]??s.toLowerCase())};
}
export function matchesSpellMetadata(record,filter){return (!filter.levels||filter.levels.has(Number(record.level)))&&(!filter.schools||filter.schools.includes(String(record.school).toLowerCase()))&&(!filter.ritual||!!record.meta?.ritual);}
