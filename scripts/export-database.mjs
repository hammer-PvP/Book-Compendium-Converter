/** Original browser-side LevelDB writer. Produces a fresh database using the
 * public LevelDB journal/manifest formats; never reads or copies an open DB. */
const utf8=new TextEncoder();
export function bytesJoin(parts){const out=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let at=0;for(const p of parts){out.set(p,at);at+=p.length;}return out;}
function variable(value){const out=[];do{let b=value%128;value=Math.floor(value/128);if(value)b|=128;out.push(b);}while(value);return Uint8Array.from(out);}
function sized(value){return bytesJoin([variable(value.length),value]);}
function crc32c(bytes){let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let b=0;b<8;b++)crc=(crc>>>1)^((crc&1)?0x82f63b78:0);}return (~crc)>>>0;}
function journal(payload){
  const parts=[];let at=0,offset=0,first=true;
  do{
    const left=32768-offset;if(left<7){parts.push(new Uint8Array(left));offset=0;}
    const count=Math.min(payload.length-at,32768-offset-7),last=at+count===payload.length;
    const type=first?(last?1:2):(last?4:3),fragment=payload.subarray(at,at+count),header=new Uint8Array(7),view=new DataView(header.buffer);
    const crc=crc32c(bytesJoin([Uint8Array.of(type),fragment]));view.setUint32(0,(((crc>>>15)|(crc<<17))+0xa282ead8)>>>0,true);view.setUint16(4,count,true);header[6]=type;
    parts.push(header,fragment);at+=count;offset=(offset+7+count)%32768;first=false;
  }while(at<payload.length);
  return bytesJoin(parts);
}
export function levelDatabase(entries){
  const header=new Uint8Array(12),view=new DataView(header.buffer);view.setBigUint64(0,1n,true);view.setUint32(8,entries.size,true);
  const parts=[header];
  for(const [key,value] of entries)parts.push(Uint8Array.of(1),sized(utf8.encode(key)),sized(utf8.encode(JSON.stringify(value))));
  const manifest=bytesJoin([variable(1),sized(utf8.encode("leveldb.BytewiseComparator")),variable(2),variable(2),variable(3),variable(3),variable(4),variable(entries.size)]);
  return new Map([["CURRENT",utf8.encode("MANIFEST-000001\n")],["MANIFEST-000001",journal(manifest)],["000002.log",journal(bytesJoin(parts))]]);
}
const EMBEDDED={Actor:{Item:"items",ActiveEffect:"effects"},Item:{ActiveEffect:"effects"},JournalEntry:{JournalEntryPage:"pages",JournalEntryCategory:"categories"}};
const COLLECTIONS={Actor:"actors",Item:"items",JournalEntry:"journal",Folder:"folders"};
export function databaseEntries(documents,folders,documentType,hierarchy={}){
  const entries=new Map();
  function visit(raw,type,collection,parentPath="",parentId=""){
    const doc=structuredClone(raw),path=parentPath?`${parentPath}.${collection}`:collection,id=parentId?`${parentId}.${doc._id}`:doc._id;
    if(!/^[A-Za-z0-9]{16}$/.test(doc._id??""))throw Error(`Invalid ${type} ID: ${doc._id}`);
    const key=`!${path}!${id}`;if(entries.has(key))throw Error(`Duplicate database key ${key}`);
    delete doc._key;
    for(const [childType,field] of Object.entries(hierarchy[type]??EMBEDDED[type]??{})){
      const children=doc[field]??[];if(!Array.isArray(children))throw Error(`Unsupported embedded collection ${type}.${field}`);
      for(const child of children)visit(child,childType,field,path,id);
      doc[field]=children.map(c=>c._id);
    }
    entries.set(key,doc);
  }
  const collection=COLLECTIONS[documentType];if(!collection)throw Error(`Unsupported compendium type ${documentType}`);
  for(const doc of documents)visit(doc,documentType,collection);
  for(const folder of folders)visit(folder,"Folder","folders");
  return entries;
}
