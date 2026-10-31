import {exportBooks,validateExport,buildExport,downloadExport} from "./exporter.mjs";
const escapeHtml=value=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
export class BCCExportApp extends foundry.applications.api.ApplicationV2{
  static DEFAULT_OPTIONS={id:"bcc-exporter",window:{title:"BCC · Exportar módulo",resizable:true},position:{width:800,height:720}};
  constructor(options={}){super(options);this.books=[];this.selected=new Set();this.identity={id:"bcc-library",title:"BCC Library",version:"1.0.0"};this.snapshot=null;this.busy=false;this.status="";this.error="";}
  async load(source){this.books=exportBooks();if(source&&this.books.some(b=>b.source===source))this.selected.add(source);return this;}
  invalidate(){this.snapshot=null;this.error="";}
  async _renderHTML(){
    const root=document.createElement("div");root.className="bcc-ui bcc-export";
    const report=this.snapshot?.report;
    root.innerHTML=`<header class="bcc-heading"><h2>Exportar módulo instalável</h2><p>Selecione conteúdos já salvos nos compêndios. Ajustes manuais serão preservados no pacote.</p></header>
      <section class="bcc-export-books">${this.books.length?this.books.map(b=>`<label class="bcc-export-book" style="border-left-color:${b.color}"><input type="checkbox" data-source="${escapeHtml(b.source)}" ${this.selected.has(b.source)?"checked":""} ${this.busy?"disabled":""}><span><strong>${escapeHtml(b.name)}</strong><small>${escapeHtml(b.source)} · ${b.packs.length} compêndios</small></span></label>`).join(""):'<p>Nenhum livro BCC importado neste World.</p>'}</section>
      <section class="bcc-export-fields"><label>Nome do módulo<input data-field="title" value="${escapeHtml(this.identity.title)}" ${this.busy?"disabled":""}></label><label>Identificador<input data-field="id" value="${escapeHtml(this.identity.id)}" ${this.busy?"disabled":""}></label><label>Versão<input data-field="version" value="${escapeHtml(this.identity.version)}" ${this.busy?"disabled":""}></label></section>
      <div class="bcc-actions"><button data-action="validate" ${this.busy||!this.selected.size?"disabled":""}><i class="fas fa-check-double"></i> Validar seleção</button><button data-action="download" ${this.busy||!report||report.errors.length?"disabled":""}><i class="fas fa-file-zipper"></i> Gerar ZIP</button></div>
      <p class="bcc-status" aria-live="polite">${escapeHtml(this.status)}</p>${this.error?`<p class="bcc-error">${escapeHtml(this.error)}</p>`:""}
      ${report?`<section class="bcc-result"><h3>${report.errors.length?"Pendências para resolver":"Pronto para empacotar"}</h3><p>${report.documents} documentos · ${report.packs.length} compêndios · ${report.assets} arquivos de mídia · ${(report.assetBytes/1048576).toFixed(1)} MiB de mídia</p><details><summary>Compêndios incluídos</summary><ul>${report.packs.map(p=>`<li>${escapeHtml(p.label)} — ${p.documents} documentos</li>`).join("")}</ul></details>${report.dependencies.length?`<p>Dependências incluídas automaticamente: ${escapeHtml(report.dependencies.join(", "))}</p>`:""}${report.errors.length?`<ul class="bcc-error">${report.errors.map(e=>`<li>${escapeHtml(e)}</li>`).join("")}</ul>`:""}<ul class="bcc-note">${report.warnings.map(e=>`<li>${escapeHtml(e)}</li>`).join("")}</ul><button data-action="report">Baixar relatório de validação</button></section>`:""}`;
    return root;
  }
  _replaceHTML(result,content){content.replaceChildren(result);}
  _onRender(context,options){super._onRender(context,options);const root=this.element;
    root.querySelectorAll("[data-source]").forEach(input=>input.addEventListener("change",()=>{if(input.checked)this.selected.add(input.dataset.source);else this.selected.delete(input.dataset.source);this.invalidate();this.render();}));
    root.querySelectorAll("[data-field]").forEach(input=>input.addEventListener("input",()=>{this.identity[input.dataset.field]=input.value;this.invalidate();root.querySelector('[data-action="download"]').disabled=true;root.querySelector(".bcc-result")?.remove();}));
    root.querySelector('[data-action="validate"]')?.addEventListener("click",()=>this.validate());
    root.querySelector('[data-action="download"]')?.addEventListener("click",()=>this.download());
    root.querySelector('[data-action="report"]')?.addEventListener("click",()=>downloadExport(new Blob([JSON.stringify(this.snapshot.report,null,2)],{type:"application/json"}),`${this.identity.id}-validation.json`));
  }
  progress(text){this.status=text;const el=this.element?.querySelector(".bcc-status");if(el)el.textContent=text;}
  async validate(){if(this.busy)return;this.busy=true;this.invalidate();await this.render();
    try{this.snapshot=await validateExport([...this.selected],this.identity,text=>this.progress(text));this.status=this.snapshot.report.errors.length?"Resolva os erros indicados antes de gerar o ZIP.":"Seleção validada. O ZIP usará este retrato dos compêndios.";}
    catch(error){this.error=error.message;}finally{this.busy=false;await this.render();}
  }
  async download(){if(this.busy||!this.snapshot)return;this.busy=true;this.error="";await this.render();
    try{const blob=await buildExport(this.snapshot,text=>this.progress(text));downloadExport(blob,`${this.snapshot.manifest.id}-v${this.snapshot.manifest.version}.zip`);this.status="ZIP gerado. Extraia a pasta em Data/modules, reinicie o Foundry e ative o módulo no World de destino.";}
    catch(error){this.error=error.message;}finally{this.busy=false;await this.render();}
  }
}
