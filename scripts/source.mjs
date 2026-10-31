import {readLibraryBook} from "./library-source.mjs";
import {sha256} from "./hash.mjs";
export const ONLINE_ROOT="https://cdn.5e.tools/2024/";
export const SOURCE_ROOT = "bcc/5etools/data/";
const ID="book-compendium-converter",sessions=new Map();let sequence=0,defaultSession;
function setting(key){try{return globalThis.game?.settings?.get(ID,key);}catch{return null;}}
export function sourceMode(){return setting("sourceMode")==="local"?"local":"online";}
export function sourceLabel(){return sourceMode()==="online"?"5etools online":"5etools local";}
export function mediaUrl(value){if(typeof value!=="string")return value;return value.replace(/^https?:\/\/(?:www\.)?5e\.tools\/img\//i,`${ONLINE_ROOT}img/`);}
export function createSourceSession({mode=sourceMode(),root=mode==="online"?`${ONLINE_ROOT}data/`:SOURCE_ROOT}={}){
  const token=`${Date.now()}-${++sequence}`,cache=new Map(),metadata={mode,root,images:mode==="online"?`${ONLINE_ROOT}img/`:"bcc/5etools/img",startedAt:new Date().toISOString(),files:[],failures:[]};
  const session={token,metadata,async readJson(relative,{optional=false}={}){
    if(!relative||relative.split("/").includes("..")||/^[a-z]+:/i.test(relative))throw Error("BCC | Caminho de dados inválido");
    const path=`${root}${relative}`;
    if(!cache.has(path))cache.set(path,(async()=>{
      for(let attempt=0;attempt<3;attempt++){
        try{
          const response=await fetch(path,{cache:"no-cache",credentials:mode==="online"?"omit":"same-origin",signal:AbortSignal.timeout(20000)});
          if(response.status===404&&optional){metadata.failures.push({path,status:404,optional:true});return null;}
          if(!response.ok){const error=Error(`HTTP ${response.status}: ${path}`);error.retry=response.status===429||response.status>=500;throw error;}
          const text=await response.text();let value;try{value=JSON.parse(text);}catch{throw Error(`BCC | O endereço não retornou JSON válido: ${path}`);}
          metadata.files.push({path,sha256:await sha256(text),etag:response.headers.get("etag"),lastModified:response.headers.get("last-modified")});session.onProgress?.(`Lendo fonte ${mode}: ${relative} (${metadata.files.length} arquivos)`);return value;
        }catch(error){if(attempt<2&&(error.retry||error.name==="TimeoutError"||error.name==="TypeError")){await new Promise(r=>setTimeout(r,250*(attempt+1)));continue;}if(mode==="local"&&optional)return null;throw Error(`BCC | Falha ao ler ${relative} (${mode}): ${error.message}`);}
      }
    })());
    try{return structuredClone(await cache.get(path));}catch(error){cache.delete(path);throw error;}
  }};
  sessions.set(token,session);while(sessions.size>8)sessions.delete(sessions.keys().next().value);return session;
}
export function getSourceSession(content){const token=content?.sourceContext?.token;if(token){const session=sessions.get(token);if(!session)throw Error("BCC | A prévia da fonte expirou. Analise o livro novamente antes de importar.");return session;}return createSourceSession(content?.sourceContext??{});}
export function readJson(relative,options){defaultSession??=createSourceSession();return defaultSession.readJson(relative,options);}
export function refreshSources(){defaultSession=null;}
export async function getBooks({session}={}){const data=await (session??(defaultSession??=createSourceSession())).readJson("books.json");if(!Array.isArray(data.book))throw Error("O catálogo do 5etools não contém o array book.");return data.book;}
export const readBook = readLibraryBook;
