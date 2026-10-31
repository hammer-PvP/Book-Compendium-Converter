import {getBooks,readBook,SOURCE_ROOT} from "./source.mjs";
import {importBook} from "./importer.mjs";
import {prepareRules} from "./rules-policy.mjs";
import {sourceColor} from "./source-colors.mjs";
import {BCCExportApp} from "./export-app.mjs";

const escapeHtml = v => String(v??"").replace(/[&<>"']/g,s=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[s]);
const kindNames={race:"Species",background:"Backgrounds",feat:"Feats",optionalfeature:"Optional Features",
 class:"Classes",subclass:"Subclasses",classFeature:"Class Features",subclassFeature:"Subclass Features",
 spell:"Spells",item:"Items & Equipment",monster:"Monsters",object:"Objects",vehicle:"Vehicles"};
export class BCCApp extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS={id:"bcc-book-importer",window:{title:"Book Compendium Converter · 0.0.11",resizable:true},position:{width:760,height:740}};
  constructor(options={}){super(options);this.books=null;this.bookId="XPHB";this.preview=null;this.busy=false;this.status="";this.result=null;this.error="";this.importMode="create";this.progress=null;this.acknowledged=false;this.search="";this.targetRules="source";}
  async load(){
    try{this.books=(await getBooks()).slice().sort((a,b)=>a.name.localeCompare(b.name,"en",{numeric:true,sensitivity:"base"}));this.targetRules=game.settings.get("book-compendium-converter","importRules")??"source";if(!this.books.some(b=>b.id===this.bookId))this.bookId=this.books[0]?.id;this.error="";}
    catch(e){this.error=e.message;this.books=[];}
    return this;
  }
  async _renderHTML(){
    const total=this.books?.length??0;
    const options=this.bookOptions();
    const counts=this.preview?Object.entries(this.preview.counts).filter(([,n])=>n>0).map(([kind,n])=>
      `<div class="bcc-stat"><strong>${n}</strong><span>${escapeHtml(kindNames[kind]??kind)}</span></div>`).join(""):"";
    const preview=this.preview?`<section class="bcc-summary">
      <h3>${escapeHtml(this.preview.book.name)}</h3>
      <p>${this.preview.chapters.length} capítulos disponíveis · ${Object.values(this.preview.counts).reduce((a,b)=>a+b,0)} registros mecânicos de origem</p>
      <div class="bcc-stats">${counts}</div>
      <p class="bcc-note">Os números não incluem as Features derivadas de Species. Nesta versão, dados não estruturados e efeitos ausentes serão sinalizados no relatório.</p>
    </section>`:`<div class="bcc-empty">Selecione um livro e clique em <strong>Analisar livro</strong>.</div>`;
    const dependencyCount=Object.values(this.preview?.dependencies??{}).reduce((a,b)=>a+b,0);
    const mode=`<label for="bcc-import-mode">Documentos existentes</label><select id="bcc-import-mode" ${this.busy?"disabled":""}><option value="create" ${this.importMode==="create"?"selected":""}>Adicionar somente os ausentes</option><option value="update" ${this.importMode==="update"?"selected":""}>Atualizar BCC sem alterações locais</option><option value="rebuild" ${this.importMode==="rebuild"?"selected":""}>Reconstruir documentos BCC deste livro</option></select><p class="bcc-note">${dependencyCount} dependências locais incluídas. Reconstruir substitui os dados dos documentos BCC existentes, incluindo alterações manuais.</p>`;
    const message=this.error?`<p class="bcc-error">${escapeHtml(this.error)}</p>`:"";
    const progress=this.progress&&!this.acknowledged?`<section class="bcc-progress" aria-live="polite"><label>${escapeHtml(this.progress.phase==="done"?"Processamento finalizado":"Importação em andamento")} · <span class="bcc-percent">${this.progress.percent}%</span></label><progress max="100" value="${this.progress.percent}" aria-label="Progresso da importação"></progress><span class="bcc-count">${this.progress.completed}/${this.progress.total} documentos processados</span>${!this.busy?'<button type="button" data-action="acknowledge">OK</button>':""}</section>`:"";
    const status=this.status?`<p class="bcc-status">${escapeHtml(this.status)}</p>`:"";
    const imageStats=this.result?.assets,imageCoverage=Object.values(imageStats?.coverage??{});
    const sumImages=key=>imageCoverage.reduce((sum,row)=>sum+(row[key]??0),0);
    const assets=imageStats?`<p>Ícones: ${imageStats.copied} arquivos copiados · ${imageStats.reused} reutilizados · ${imageStats.unresolved.length} campos sem imagem. Pasta: <code>assets/srd5e</code>.</p><p>${sumImages("specific")} documentos com imagem específica · ${sumImages("inherited")} com imagem herdada · ${sumImages("fallback")} com ícone de categoria · ${imageStats.failures.length} fontes de imagem com falha. Detalhamento por categoria no relatório.</p>`:"";
    const after=this.result?`<section class="bcc-result"><h3>Importação ${this.result.errors.length ? "com erros" : (this.result.unresolved.length||this.result.incomplete.length ? "com pendências" : "concluída")}</h3>
      <p>${Object.values(this.result.created).reduce((a,b)=>a+b,0)} novos documentos · ${Object.values(this.result.updated??{}).reduce((a,b)=>a+b,0)} atualizados · ${Object.values(this.result.existing??{}).reduce((a,b)=>a+b,0)} já existentes · ${this.result.errors.length} erros de conversão, preparação ou gravação · ${this.result.unresolved.length} vínculos não resolvidos · ${this.result.incomplete.length} pontos mecânicos pendentes</p>
      ${assets}<button type="button" data-action="report"><i class="fas fa-file-arrow-down"></i> Baixar relatório JSON</button></section>`:"";
    const root=document.createElement("div");root.className="bcc-ui";
    root.innerHTML=`<header class="bcc-heading"><h2>Book Compendium Converter</h2><p>Fonte local: <code>${SOURCE_ROOT}</code> · ${total} livros</p></header>
      <section class="bcc-selector"><label for="bcc-book-search">Pesquisar livros</label><input type="search" id="bcc-book-search" value="${escapeHtml(this.search)}" placeholder="Nome ou sigla do livro" ${this.busy?"disabled":""}>
      <label for="bcc-select-book">Livro do 5etools</label><select id="bcc-select-book" ${this.busy?"disabled":""}>${options}</select>
      <label for="bcc-target-rules">Regras de destino</label><select id="bcc-target-rules" ${this.busy?"disabled":""}><option value="source" ${this.targetRules==="source"?"selected":""}>Preservar as versões da fonte</option><option value="2024" ${this.targetRules==="2024"?"selected":""}>2024 — compatibilidade de subclasses</option><option value="2014" ${this.targetRules==="2014"?"selected":""}>2014 — preferir variantes originais</option></select>
      <p class="bcc-note">2024 prefere variantes adaptadas e reúne concessões iniciais de subclasse no nível 3. Outros recursos da classe mantêm as regras de origem. Reanalise ao mudar esta opção.</p>
        <div class="bcc-actions"><button type="button" data-action="inspect" ${this.busy||!total?"disabled":""}><i class="fas fa-magnifying-glass"></i> Analisar livro</button>
        <button type="button" data-action="import" ${this.busy||!this.preview?"disabled":""}><i class="fas fa-box-archive"></i> Criar compêndios</button><button type="button" data-action="export" ${this.busy?"disabled":""}><i class="fas fa-file-export"></i> Exportar</button></div>
      </section>${mode}${message}${status}${progress}${preview}${after}
      <section class="bcc-warning"><h4><i class="fas fa-triangle-exclamation"></i> Versão experimental</h4>
      <p>Cria e exporta compêndios nativos com Advancements e vínculos locais. <strong>Não declara compatibilidade completa com Character Builder ou level-up.</strong> Teste em mundo de laboratório.</p></section>`;
    return root;
  }
  _replaceHTML(result,content){content.replaceChildren(result);}
  bookOptions(){const normalize=s=>String(s).normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase();const query=normalize(this.search);
    return (this.books??[]).filter(b=>normalize(`${b.name} ${b.id}`).includes(query)).map(book=>`<option value="${escapeHtml(book.id)}" style="color:${sourceColor(book.id)}" ${book.id===this.bookId?"selected":""}>${escapeHtml(book.name)} (${escapeHtml(book.id)})</option>`).join("")||'<option value="">Nenhum livro encontrado</option>';
  }
  _onRender(context,options){super._onRender(context,options);
    const root=this.element;
    root.querySelector("#bcc-book-search")?.addEventListener("input",e=>{this.search=e.target.value;const select=root.querySelector("#bcc-select-book");select.innerHTML=this.bookOptions();if(select.value!==this.bookId){this.bookId=select.value;this.preview=null;this.result=null;root.querySelector('[data-action="import"]').disabled=true;}root.querySelector('[data-action="inspect"]').disabled=!select.value;});
    root.querySelector("#bcc-target-rules")?.addEventListener("change",e=>{this.targetRules=e.target.value;this.preview=null;this.result=null;this.status="Reanalise o livro para aplicar as regras de destino.";this.render();});
    root.querySelector("#bcc-select-book")?.addEventListener("change",e=>{this.bookId=e.target.value;this.preview=null;this.result=null;this.progress=null;this.status="";this.error="";this.render();});
    root.querySelector("#bcc-import-mode")?.addEventListener("change",e=>{this.importMode=e.target.value;});
    root.querySelector('[data-action="inspect"]')?.addEventListener("click",()=>this.inspect());
    root.querySelector('[data-action="import"]')?.addEventListener("click",()=>this.importSelected());
    root.querySelector('[data-action="export"]')?.addEventListener("click",async()=>{if(!game.user.isGM)return;const exporter=await new BCCExportApp().load(this.bookId);await exporter.render(true);});
    root.querySelector('[data-action="acknowledge"]')?.addEventListener("click",()=>{this.acknowledged=true;this.render();});
    root.querySelector('[data-action="report"]')?.addEventListener("click",()=>this.downloadReport());
  }
  async inspect(){if(this.busy)return;this.busy=true;this.error="";this.status="Carregando dados estruturados da publicação...";this.preview=null;await this.render();
    try{this.preview=prepareRules(await readBook(this.bookId),this.targetRules);this.status="Dados carregados. Confira a distribuição por categoria.";}
    catch(e){this.error=e.message;this.status="";console.error("BCC | Inspector:",e);}
    finally{this.busy=false;await this.render();}
  }
  async importSelected(){if(this.busy||!this.preview)return;
    if(!game.user.isGM){ui.notifications.error("BCC | Apenas GM pode importar livros.");return;}
    const book=this.preview;
    const approve=await foundry.applications.api.DialogV2.confirm({window:{title:"BCC — Confirmar importação"},
      content:`${this.importMode==="rebuild"?"<p><strong>Os dados dos documentos BCC deste livro serão reconstruídos. Alterações manuais nesses documentos serão substituídas.</strong></p>":""}<p>Importar <strong>${escapeHtml(book.book.name)}</strong> em compêndios do World?</p><p>Esta é uma versão de laboratório. A conversão mecânica ainda exige homologação com Character Builder e poderá apresentar lacunas. Use um mundo de testes.</p>`,
      yes:{label:"Importar"},no:{label:"Cancelar"}});
    if(!approve)return;
    this.busy=true;this.error="";this.status="Preparando importação...";this.result=null;this.progress={phase:"prepare",percent:0,completed:0,total:0};this.acknowledged=false;await this.render();
    try{this.result=await importBook(book,(text,state)=>{this.status=text;if(state)this.progress=state;const root=this.element,el=root?.querySelector(".bcc-status");if(el)el.textContent=text;
      const bar=root?.querySelector("progress");if(bar&&state){bar.value=state.percent;root.querySelector(".bcc-percent").textContent=`${state.percent}%`;root.querySelector(".bcc-count").textContent=`${state.completed}/${state.total} documentos processados`;}},{mode:this.importMode,targetRules:this.targetRules});
      await game.settings.set("book-compendium-converter","importRules",this.targetRules);
      if(this.result.errors.length)ui.notifications.error(`BCC | Importação parcial: ${this.result.errors.length} erros. Baixe o relatório.`);
      else if(this.result.unresolved.length||this.result.incomplete.length)ui.notifications.warn("BCC | Documentos gravados; existem pendências mecânicas. Baixe o relatório.");
      else ui.notifications.info("BCC | Documentos gravados e conferidos. Ainda exige homologação no Character Builder.");}
    catch(e){this.error=e.message;this.status="Importação interrompida; consulte o console e verifique os compêndios já criados.";console.error("BCC | Import error:",e);ui.notifications.error(`BCC | ${e.message}`);}
    finally{this.busy=false;await this.render();}
  }
  downloadReport(){if(!this.result)return;
    const data=JSON.stringify(this.result,null,2);
    if(typeof foundry.utils.saveDataToFile==="function") foundry.utils.saveDataToFile(data,"application/json",`BCC-${this.bookId}-report.json`);
    else {const blob=new Blob([data],{type:"application/json"});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=`BCC-${this.bookId}-report.json`;a.click();URL.revokeObjectURL(url);}
  }
}
