/** Copy persistent source fields, not live Documents or Proxy identities. */
export function documentData(value) {
  const visiting=new WeakSet();
  function copy(v,path) {
    if(v===null||['string','boolean','number','undefined'].includes(typeof v))return v;
    if(typeof v!=='object')throw Error(`BCC: non-persistent ${typeof v} at ${path}`);
    if(visiting.has(v))throw Error(`BCC: circular source data at ${path}`);
    visiting.add(v);
    try {
      if(typeof v.toObject==='function')return copy(v.toObject(true),path);
      if(v instanceof Date)return v.toISOString();
      if(v instanceof Set)return [...v].map((x,i)=>copy(x,`${path}.${i}`));
      if(v instanceof Map)return Object.fromEntries([...v].map(([k,x])=>[k,copy(x,`${path}.${String(k)}`)]));
      if(Array.isArray(v))return v.map((x,i)=>copy(x,`${path}.${i}`));
      const out={};
      for(const k of Object.keys(v)){
        const descriptor=Object.getOwnPropertyDescriptor(v,k);
        // Native compatibility accessors are computed aliases, not source fields.
        if(descriptor&&!('value' in descriptor))continue;
        Object.defineProperty(out,k,{value:copy(descriptor?descriptor.value:v[k],`${path}.${k}`),writable:true,enumerable:true,configurable:true});
      }
      return out;
    } finally {visiting.delete(v);}
  }
  if(value&&typeof value.toObject!=='function'&&value._source)value=value._source;
  return copy(value,'source');
}
