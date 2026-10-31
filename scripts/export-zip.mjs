/** ZIP32 with optional native deflate. No external ZIP library or service. */
const utf8=new TextEncoder(),table=Uint32Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=(n>>>1)^((n&1)?0xedb88320:0);return n>>>0;});
function crc32(bytes){let n=0xffffffff;for(const b of bytes)n=table[(n^b)&255]^(n>>>8);return (~n)>>>0;}
export class ExportZip{
  constructor(){this.parts=[];this.directory=[];this.offset=0;this.names=new Set();}
  async add(path,data,{compress=false}={}){
    if(!path||path.startsWith("/")||path.split("/").some(s=>s==="..")||this.names.has(path))throw Error(`Invalid or duplicate ZIP path ${path}`);
    const name=utf8.encode(path);if(name.length>65535||this.names.size>=65535)throw Error("ZIP entry limit exceeded");
    const raw=typeof data==="string"?utf8.encode(data):data instanceof Blob?new Uint8Array(await data.arrayBuffer()):data;
    let payload=raw,method=0;
    if(compress&&typeof CompressionStream==="function")try{const stream=new Blob([raw]).stream().pipeThrough(new CompressionStream("deflate-raw"));const packed=new Uint8Array(await new Response(stream).arrayBuffer());if(packed.length<raw.length){payload=packed;method=8;}}catch{}
    if(this.offset+payload.length>0xffffffff)throw Error("Export exceeds the ZIP32 size limit");
    const crc=crc32(raw),header=new Uint8Array(30+name.length),h=new DataView(header.buffer);h.setUint32(0,0x04034b50,true);h.setUint16(4,20,true);h.setUint16(6,0x800,true);h.setUint16(8,method,true);h.setUint16(12,0x21,true);h.setUint32(14,crc,true);h.setUint32(18,payload.length,true);h.setUint32(22,raw.length,true);h.setUint16(26,name.length,true);header.set(name,30);
    const central=new Uint8Array(46+name.length),c=new DataView(central.buffer);c.setUint32(0,0x02014b50,true);c.setUint16(4,20,true);c.setUint16(6,20,true);c.setUint16(8,0x800,true);c.setUint16(10,method,true);c.setUint16(14,0x21,true);c.setUint32(16,crc,true);c.setUint32(20,payload.length,true);c.setUint32(24,raw.length,true);c.setUint16(28,name.length,true);c.setUint32(42,this.offset,true);central.set(name,46);
    this.names.add(path);this.parts.push(header,payload);this.directory.push(central);this.offset+=header.length+payload.length;
  }
  blob(){const size=this.directory.reduce((n,d)=>n+d.length,0),end=new Uint8Array(22),v=new DataView(end.buffer);if(this.offset+size>0xffffffff)throw Error("Export exceeds ZIP32 limits");v.setUint32(0,0x06054b50,true);v.setUint16(8,this.names.size,true);v.setUint16(10,this.names.size,true);v.setUint32(12,size,true);v.setUint32(16,this.offset,true);return new Blob([...this.parts,...this.directory,end],{type:"application/zip"});}
}
