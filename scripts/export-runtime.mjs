import {registerResourceBindings,resourceUpdates} from "./resource-bindings.mjs";
import {registerPrerequisiteRuntime} from "./prerequisite-runtime.mjs";
/** Resource references cannot know future embedded Item IDs. This small,
 * original runtime is included in exported modules; it has no BCC dependency. */
const moduleId=/\/modules\/([^/]+)\//.exec(import.meta.url)?.[1];
const normalize=value=>String(value??"").trim().toLowerCase();
function raw(item){return item.toObject?item.toObject():item;}
export function bindExportedResources(items,owner=moduleId){const updates=resourceUpdates(items);if(!owner)return updates;return updates.filter(u=>{const d=raw(items.find(i=>(i.id??i._id)===u._id));return d.flags?.bcc?.resourceBindings?.some(b=>b.reference?.uuid?.startsWith(`Compendium.${owner}.`)||b.reference?.actorDeferred&&d._stats?.compendiumSource?.startsWith(`Compendium.${owner}.`));});}
if(globalThis.Hooks)Hooks.once("init",()=>{registerPrerequisiteRuntime();registerResourceBindings();});
