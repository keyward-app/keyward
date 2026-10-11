// Test-only entry. Every view mounts the production App over a production
// WebBackend. Playwright routes the real HTTP requests to a stateful authority.
import { createRoot } from "react-dom/client";
import { App } from "../../ui/core/src/ui/App";
import { Lang, setLang } from "../../ui/core/src/i18n";
import { WebBackend } from "../../web/src/backend/index";
import type { Change } from "../../ui/core/src/backend";
type Config={server:string;email:string;password:string;now:number;ssh:boolean};
const events:Change[]=[];
const anchors=new Map<string,Element>();
let backend:WebBackend;
let config:Config;
const storage=()=>{const values=new Map<string,string>();return {getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>void values.set(k,v),removeItem:(k:string)=>void values.delete(k)};};
async function fresh(){const b=new WebBackend({server:config.server,deviceStorage:storage(),idle:null,now:()=>config.now});await b.login({email:config.email,password:config.password});return b;}
const api={
  async start(c:Config){
    config=c;setLang(Lang.En);backend=await fresh();backend.subscribe(e=>events.push(e));
    const item=c.ssh?"contract-key":"contract-login";
    const routes:Record<string,string>={reader:`personal › contract-folder › ${item}`,catalog:"personal › contract-folder",search:"Contract"};
    if(!c.ssh){routes.map=`personal › contract-folder › ${item} map:${item}`;routes.writer=`personal › contract-folder › ${item} > edit`;}
    const style=document.createElement("style");style.textContent="body{overflow:auto!important;height:auto!important;display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:8px}.contract-view{height:520px;position:relative;min-width:0}.contract-view .window{height:520px} .contract-view .loading{height:520px}";document.head.append(style);
    for(const [id,line] of Object.entries(routes)){const host=document.createElement("div");host.id=id;host.className="contract-view";document.body.append(host);createRoot(host).render(<App backend={backend} writes={backend} line={line} autoBiometric={false}/>);}
  },
  baseline(){for(const host of document.querySelectorAll(".contract-view"))if(host.id!=="writer")for(const selector of [".window",".insp > .doc:not(.ghost)"])anchors.set(host.id+"|"+selector,host.querySelector(selector)!);events.length=0;},
  lifecycle(){return [...anchors].every(([key,anchor])=>{const [id,selector]=key.split("|");return document.getElementById(id!)!.querySelector(selector!)===anchor;});},
  changes(){return [...events];},
  async cold(id:string){const b=await fresh();try{return await b.item(id);}finally{await b.lock();}},
};
declare global {interface Window {stateContract:typeof api;}}
window.stateContract=api;
