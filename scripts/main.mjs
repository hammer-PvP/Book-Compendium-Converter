import {registerSpellLists} from "./spell-lists.mjs";
import {registerResourceBindings} from "./resource-bindings.mjs";
import {BCCApp} from "./app.mjs";
import {getBooks,readBook} from "./source.mjs";
import {injectBCCShortcut} from "./sidebar.mjs";

const ID="book-compendium-converter";
let app;
Hooks.once("init",()=>{
  game.settings.register(ID,"spellLists",{scope:"world",config:false,type:Array,default:[]});
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
    getBooks,readBook,version:"0.0.6"
  };
  // The sidebar may already be rendered before the ready hook.
  injectBCCShortcut(null,ui.compendium?.element);
  console.info("BCC 0.0.6 | Ready. Acesse pelo botão na aba Compêndios ou game.bcc.open()");
});
Hooks.on("renderCompendiumDirectory",injectBCCShortcut);
