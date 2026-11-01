import {registerPrerequisiteRuntime} from "./prerequisite-runtime.mjs";
import {refreshSources} from "./source.mjs";
import {registerSpellLists} from "./spell-lists.mjs";
import {registerResourceBindings} from "./resource-bindings.mjs";
import {BCCApp} from "./app.mjs";
import {getBooks,readBook} from "./source.mjs";
import {injectBCCShortcut} from "./sidebar.mjs";

const ID="book-compendium-converter";
let app;
Hooks.once("init",()=>{
  game.settings.register(ID,"sourceMode",{name:"Fonte de dados",hint:"Online funciona sem instalar dados ou imagens. Local usa a pasta bcc/5etools existente.",scope:"world",config:true,type:String,choices:{online:"5etools online",local:"5etools local (opcional)"},default:"online",onChange:()=>{refreshSources();if(app){app.preview=null;app.result=null;app.load().then(()=>app.render());}}});
  registerPrerequisiteRuntime();
  game.settings.register(ID,"importRules",{scope:"world",config:false,type:String,default:"source"});
  game.settings.register(ID,"exportTargets",{scope:"world",config:false,type:Object,default:{}});
  game.settings.register(ID,"spellLists",{scope:"world",config:false,type:Array,default:[]});
  game.settings.register(ID,"artworkSource",{name:"Source artwork directory or URL",hint:"Online: optional image URL override. Local: optional image directory or URL. Leave blank for automatic defaults. Resolved images are copied to Data/assets/srd5e and reused on later imports.",scope:"world",config:true,type:String,default:""});
  registerResourceBindings();
  game.settings.register(ID,"lastImport",{name:"Last Import",scope:"world",config:false,type:Object,default:{}});
});
Hooks.once("ready",()=>{
  setTimeout(()=>registerSpellLists(),0);
  if(!game.user.isGM)return;
  game.bcc={
    open:async()=>{
      if(!app)app=new BCCApp();
      if(app.rendered){app.bringToFront();return app;}
      await app.load();await app.render(true);return app;
    },
    getBooks,readBook,version:"0.1.1"
  };
  // The sidebar may already be rendered before the ready hook.
  injectBCCShortcut(null,ui.compendium?.element);
  console.info("BCC 0.1.1 | Ready. Acesse pelo botão na aba Compêndios ou game.bcc.open()");
});
Hooks.on("renderCompendiumDirectory",injectBCCShortcut);
