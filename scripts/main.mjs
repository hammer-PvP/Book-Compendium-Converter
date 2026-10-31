import {registerSpellLists} from "./spell-lists.mjs";
import {registerResourceBindings} from "./resource-bindings.mjs";
import {BCCApp} from "./app.mjs";
import {getBooks,readBook} from "./source.mjs";
import {injectBCCShortcut} from "./sidebar.mjs";

const ID="book-compendium-converter";
let app;
Hooks.once("init",()=>{
  game.settings.register(ID,"importRules",{scope:"world",config:false,type:String,default:"source"});
  game.settings.register(ID,"spellLists",{scope:"world",config:false,type:Array,default:[]});
  game.settings.register(ID,"artworkSource",{name:"Source artwork directory or URL",hint:"Optional source for image paths referenced by local 5etools data. Resolved images are copied to Data/assets/srd5e and reused on later imports.",scope:"world",config:true,type:String,default:"bcc/5etools/img"});
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
    getBooks,readBook,version:"0.0.11"
  };
  // The sidebar may already be rendered before the ready hook.
  injectBCCShortcut(null,ui.compendium?.element);
  console.info("BCC 0.0.11 | Ready. Acesse pelo botão na aba Compêndios ou game.bcc.open()");
});
Hooks.on("renderCompendiumDirectory",injectBCCShortcut);
