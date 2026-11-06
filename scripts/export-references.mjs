/** References are classified by use; embedded provenance is not an executable link. */
export function referenceRole(path,document){
  if(path.includes('externalReferences')){const at=path.indexOf('externalReferences'),ref=document?.flags?.bcc?.externalReferences?.[path[at+1]];return document?.type==='subclass'&&ref?.kind==='class'&&path.at(-1)==='uuid'?'required':'provenance';}
  if(path.includes('_stats')||path.includes('actorOrigin')||path.includes('sourceContext')||path.includes('assets'))return 'provenance';
  if(path.includes('bundleComponent')&&path.at(-1)==='template')return 'provenance';
  if(path.includes('description')||path.includes('text')&&path.includes('content'))return 'descriptive';
  return 'required';
}
export function containerClosure(documents,ids){
  const selected=new Set(ids);let changed=true;
  while(changed){changed=false;for(const d of documents){if(selected.has(d._id)&&d.system?.container&&!selected.has(d.system.container)){selected.add(d.system.container);changed=true;}if(d.system?.container&&selected.has(d.system.container)&&!selected.has(d._id)){selected.add(d._id);changed=true;}}}
  return documents.filter(d=>selected.has(d._id));
}
export function folderClosure(folders,documents){
  const ids=new Set(documents.map(d=>d.folder).filter(Boolean));let changed=true;
  while(changed){changed=false;for(const f of folders)if(ids.has(f._id)&&f.folder&&!ids.has(f.folder)){ids.add(f.folder);changed=true;}}
  return folders.filter(f=>ids.has(f._id));
}
