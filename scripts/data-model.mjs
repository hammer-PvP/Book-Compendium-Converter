/** Original BCC data preparation. Interprets data; never executes source expressions. */
export const DEFAULT_SOURCES = Object.freeze({spell:"PHB",item:"DMG",monster:"MM",feat:"PHB",optionalfeature:"PHB",race:"PHB",background:"PHB"});
export const canonical = value => String(value ?? "").trim().toLowerCase();
export const clone = value => structuredClone(value);
export function merge(base, patch) {
  const out = clone(base ?? {});
  for (const [key, value] of Object.entries(patch ?? {})) {
    if (["__proto__", "constructor", "prototype"].includes(key)) continue;
    out[key] = value && typeof value === "object" && !Array.isArray(value)
      ? merge(out[key] && typeof out[key] === "object" && !Array.isArray(out[key]) ? out[key] : {}, value) : clone(value);
  }
  return out;
}
export function identity(kind, r) {
  return [kind, r.source, r.name, r.className ?? "", r.classSource ?? "",
    r.subclassShortName ?? r.shortName ?? "", r.subclassSource ?? "", r.level ?? "", r.raceName ?? "", r.raceSource ?? ""].map(canonical).join("|");
}
export function textOf(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(textOf).join(" ");
  if (!value || typeof value !== "object") return "";
  return textOf(value.entries ?? value.entry ?? value.items ?? value.text ?? value.rows ?? []);
}
export const plainText = value => textOf(value).replace(/\{@([^\s}]+)\s+([^}]+)\}/g, (match, tag, body) => { const parts=body.split("|"); return ["spell","item","variantrule","action","condition","skill","sense","feat"].includes(tag) ? parts[2] || parts[0] : parts[0]; });
const array = x => Array.isArray(x) ? x : x == null ? [] : [x];
function pathOwner(root, path) {
  const parts = String(path).split("."); let owner = root;
  for (const part of parts.slice(0, -1)) {
    if (["__proto__", "constructor", "prototype"].includes(part)) throw Error("Unsafe data path");
    owner = owner[part] ??= {};
  }
  if (["__proto__", "constructor", "prototype"].includes(parts.at(-1))) throw Error("Unsafe data path");
  return [owner, parts.at(-1)];
}
function mapStrings(value, fn) {
  if (typeof value === "string") return fn(value);
  if (Array.isArray(value)) return value.map(x => mapStrings(x, fn));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, mapStrings(v, fn)]));
  return value;
}
function arithmetic(expression) {
  const input=String(expression).replace(/\s/g,"");
  if(input.length>256||!/^[\d.+*/()\-]+$/.test(input))throw Error("Unsupported arithmetic expression");
  const tokens=input.match(/\d+(?:\.\d*)?|[()+*/\-]/g)??[];if(tokens.join("")!==input)throw Error("Unsupported numeric token");let pos=0,depth=0;
  function factor(){if(++depth>64)throw Error("Expression is too deep");let value;
    if(tokens[pos]==="+"){pos++;value=factor();}
    else if(tokens[pos]==="-"){pos++;value=-factor();}
    else if(tokens[pos]==="("){pos++;value=sum();if(tokens[pos++]!==")")throw Error("Unclosed expression");}
    else{value=Number(tokens[pos++]);if(!Number.isFinite(value))throw Error("Invalid numeric token");}
    depth--;return value;
  }
  function product(){let value=factor();while(tokens[pos]==="*"||tokens[pos]==="/"){const op=tokens[pos++],right=factor();value=op==="*"?value*right:value/right;}return value;}
  function sum(){let value=product();while(tokens[pos]==="+"||tokens[pos]==="-"){const op=tokens[pos++],right=product();value=op==="+"?value+right:value-right;}return value;}
  const value=sum();if(pos!==tokens.length||!Number.isFinite(value))throw Error("Invalid arithmetic result");return value;
}
function resolveVariables(value,record,issue){
  const ability=name=>Math.floor((Number(record[name]??10)-10)/2);
  const cr=typeof record.cr==="object"?record.cr?.cr:record.cr;
  const [n,d]=String(cr??"0").split("/").map(Number),challenge=d?n/d:n;
  const proficiency=Math.max(2,1+Math.ceil((challenge||0)/4));
  return mapStrings(value,text=>text.replace(/<\$([a-z_]+?)(?:__(.*?))?\$>/g,(raw,mode,detail)=>{
    const short=typeof record.shortName==="string"?record.shortName:record.name;
    if(mode==="name")return record.name??raw;
    if(mode==="short_name")return short??raw;
    if(mode==="title_short_name")return short?short[0].toUpperCase()+short.slice(1):raw;
    if(["dc","spell_dc","to_hit","damage_mod"].includes(mode)&&["str","dex","con","int","wis","cha"].includes(detail)){
      const modifier=ability(detail);
      if(mode==="dc"||mode==="spell_dc")return String(8+modifier+proficiency);
      if(mode==="to_hit")return `${modifier+proficiency>=0?"+":""}${modifier+proficiency}`;
      return modifier>0?` + ${modifier}`:modifier<0?` - ${Math.abs(modifier)}`:"";
    }
    if(mode==="damage_avg")try{
      const formula=String(detail).replace(/\b(str|dex|con|int|wis|cha)\b/g,a=>String(ability(a))).replace(/\bsize_mult\b/g,String(({L:2,H:3,G:4})[record.size?.[0]]??1));
      return String(Math.floor(arithmetic(formula)));
    }catch(error){issue(error.message);}
    return raw;
  }));
}
export function applyMods(record, mods, issue) {
  for (const [path, operations] of Object.entries(mods ?? {})) for (const raw of array(operations)) {
    const op = typeof raw === "string" ? {mode: raw} : resolveVariables(raw,record,issue);
    if (!op?.mode) { issue(`Invalid modification at ${path}`); continue; }
    const paths = path === "*" ? Object.keys(record).filter(k => !k.startsWith("_")) : [path];
    for (const p of paths) {
      const [owner, key] = pathOwner(record, p);
      const current = owner[key];
      const values = clone(array(op.items ?? op.item));
      const nameOf = x => canonical(typeof x === "string" ? x : x?.name);
      const matches = x => array(op.names ?? op.name ?? op.replace).some(n => nameOf(x) === canonical(n));
      switch (op.mode) {
        case "addSenses": {
          for(const sense of array(op.senses)){
            const a=record.senses??=[],at=a.findIndex(v=>new RegExp(`^${sense.type}\\s`,"i").test(v));
            const value=`${sense.type} ${sense.range} ft.`;
            if(at<0)a.push(value);else if(Number(/\d+/.exec(a[at])?.[0]??0)<Number(sense.range))a[at]=value;
            record.senses=a;
          }break;
        }
        case "scalarAddHit": case "scalarAddDc": {
          const tag=op.mode==="scalarAddHit"?"hit":"dc",re=new RegExp(`\\{@${tag} ([+-]?\\d+)`,"g");
          owner[key]=mapStrings(current,s=>s.replace(re,(m,n)=>`{@${tag} ${Number(n)+Number(op.scalar)}`));break;
        }
        case "maxSize": {const sizes=["T","S","M","L","H","G"],max=sizes.indexOf(op.max);if(max>=0)record.size=array(record.size).map(s=>sizes.indexOf(s)>max?op.max:s);break;}
        case "prefixSuffixStringProp": {
          const props=op.prop==="*"?Object.keys(current??{}):[op.prop];
          for(const prop of props)if(typeof owner[key]?.[prop]==="string")owner[key][prop]=`${op.prefix??""}${owner[key][prop]}${op.suffix??""}`;
          break;
        }
        case "appendArr": owner[key] = [...array(current), ...values]; break;
        case "prependArr": owner[key] = [...values, ...array(current)]; break;
        case "appendIfNotExistsArr": owner[key] = [...array(current), ...values.filter(v => !array(current).some(x => JSON.stringify(x) === JSON.stringify(v)))]; break;
        case "insertArr": { const a = [...array(current)]; a.splice(Number(op.index ?? 0), 0, ...values); owner[key] = a; break; }
        case "removeArr": owner[key] = array(current).filter(x => !matches(x)); break;
        case "replaceArr": case "replaceOrAppendArr": {
          const a = [...array(current)]; const at = typeof op.replace === "number" ? op.replace : a.findIndex(matches);
          if (at >= 0 && at < a.length) a.splice(at, 1, ...values);
          else if (op.mode === "replaceOrAppendArr") a.push(...values);
          else issue(`Modification target missing: ${p} / ${String(op.replace)}`);
          owner[key] = a; break;
        }
        case "renameArr": {
          owner[key] = array(current).map(x => {
            const ren = array(op.renames).find(r => nameOf(x) === canonical(r.rename));
            return ren ? (typeof x === "string" ? ren.with : {...x, name: ren.with}) : x;
          }); break;
        }
        case "replaceTxt": {
          try { const re = new RegExp(op.replace, op.flags ?? "g"); owner[key] = mapStrings(current, s => s.replace(re, op.with ?? "")); }
          catch { issue(`Invalid text modification at ${p}`); } break;
        }
        case "setProp": { const [o, k] = pathOwner(record, op.prop ?? p); o[k] = clone(op.value); break; }
        case "set": owner[key] = clone(op.value); break;
        case "remove": delete owner[key]; break;
        case "appendStr": owner[key] = `${current ?? ""}${op.joiner ?? ""}${op.str ?? ""}`; break;
        case "scalarAddProp": case "scalarMultProp": {
          const target = op.prop === "*" ? Object.keys(current ?? {}) : [op.prop];
          for (const prop of target) {
            const o = prop ? (owner[key] ??= {}) : owner, k = prop ?? key;
            const n = Number(o[k]); if (!Number.isFinite(n)) { issue(`Non-numeric modification at ${p}.${prop ?? ""}`); continue; }
            const v = op.mode === "scalarAddProp" ? n + Number(op.scalar) : n * Number(op.scalar);
            o[k] = op.floor ? Math.floor(v) : v;
          } break;
        }
        default: issue(`Unsupported modification ${op.mode} at ${p}`);
      }
    }
  }
  return record;
}
export function variantOf(parent, patch, issue) {
  const out = merge(parent, Object.fromEntries(Object.entries(patch).filter(([k]) => !["_mod", "_versions", "_copy", "_abstract", "_implementations", "_variables"].includes(k))));
  delete out._versions; delete out._copy;
  applyMods(out, patch._mod ?? patch._copy?._mod, issue);
  out._bccVariantOf = {name: parent.name, source: parent.source};
  return out;
}
export function prepareRecords(kind, records, issues, {templates=[]} = {}) {
  const cache = new Map(), active = new Set();
  const issueFor = r => message => issues.push({category: kind, name: r.name, source: r.source, message});
  const resolve = r => {
    if (cache.has(r)) return cache.get(r);
    if (active.has(r)) { issueFor(r)("Circular copy dependency"); return null; }
    active.add(r); let out = clone(r);
    if (r._copy) {
      const ref = r._copy;
      const context = ["className","classSource","shortName","subclassShortName","subclassSource","level","raceName","raceSource"];
      const candidates=records.filter(x=>x!==r&&canonical(x.name)===canonical(ref.name)&&canonical(x.source)===canonical(ref.source??r.source)&&context.every(k=>ref[k]==null||canonical(ref[k])===canonical(x[k])));
      const base=candidates.length===1?candidates[0]:candidates.find(x=>context.every(k=>ref[k]!=null||r[k]==null||canonical(r[k])===canonical(x[k])));
      const inherited = base && resolve(base);
      if (!inherited) issueFor(r)(`Missing copy dependency ${ref.name}|${ref.source ?? r.source}`);
      else {
        out = merge(inherited,r);
        for(const ref of r._copy._templates??[]){
          const template=templates.find(t=>canonical(t.name)===canonical(ref.name??ref)&&(!ref.source||canonical(t.source)===canonical(ref.source)));
          if(!template){issueFor(r)(`Missing copy template ${ref.name??ref}`);continue;}
          const defaults=Object.fromEntries(Object.entries(template.apply?._root??{}).filter(([key])=>!(key in r)));
          out=merge(out,defaults);applyMods(out,template.apply?._mod,issueFor(r));
        }
        out = merge(out, r);
        // Publication flags and presentation metadata are not inherited without an explicit preserve instruction.
        for (const k of ["srd", "srd52", "basicRules", "basicRules2024", "reprintedAs", "otherSources", "additionalSources", "hasFluff", "hasFluffImages", "_versions"])
          if (!(k in r) && !ref._preserve?.[k] && !ref._preserve?.["*"]) delete out[k];
        applyMods(out, ref._mod, issueFor(r));
      }
      delete out._copy;
      out._bccCopyOf={name:ref.name,source:ref.source??r.source};
    }
    out=resolveVariables(out,out,issueFor(r));
    active.delete(r); cache.set(r, out); return out;
  };
  const result = [];
  for (const r of records) {
    const base = resolve(r); if (!base) continue;
    result.push(base);
    for (const version of base._versions ?? []) {
      const definitions = version._abstract && version._implementations?.length
        ? version._implementations.map(impl => merge(mapStrings(version._abstract, s => s.replace(/\{\{([^}]+)\}\}/g, (m, k) => impl._variables?.[k] ?? m)), impl)) : [version];
      for (const def of definitions) result.push(variantOf(base, def, issueFor(r)));
    }
  }
  return result;
}
export function attachSubraces(races, subraces, issues) {
  const result = [...races];
  for (const sub of subraces) {
    const parent = races.find(r => canonical(r.name) === canonical(sub.raceName) && canonical(r.source) === canonical(sub.raceSource));
    if (!parent) { issues.push({category: "race", name: sub.name, message: "Missing parent species"}); continue; }
    const out = merge(parent, sub);
    out.name = sub.name?.includes(parent.name) ? sub.name : `${parent.name} (${sub.name ?? sub.source})`;
    out.entries = [...clone(parent.entries ?? [])];
    for (const entry of sub.entries ?? []) {
      const name = entry?.data?.overwrite, at = name ? out.entries.findIndex(e => canonical(e.name) === canonical(name === true ? entry.name : name)) : -1;
      if (at >= 0) out.entries.splice(at, 1, clone(entry)); else out.entries.push(clone(entry));
    }
    out._bccVariantOf = {name: parent.name, source: parent.source}; delete out._versions;
    result.push(out);
  }
  return result;
}
