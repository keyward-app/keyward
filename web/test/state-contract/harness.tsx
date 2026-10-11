import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { webcrypto } from "node:crypto";
import { App } from "../../../ui/core/src/ui/App";
import { ChangeKind, type Backend, type Change } from "../../../ui/core/src/backend";
import { SecretField } from "../../../ui/core/src/model/types";
import { Lang, setLang } from "../../../ui/core/src/i18n";
import { draftOf, formFromDetail } from "../../../ui/core/src/edit/draft";
import type { ItemDraft } from "../../../ui/core/src/writes";
import { WebBackend } from "../../src/backend/index";
import { isWebError } from "../../src/backend/errors";
import { MapStorage } from "../helpers";
import { Authority, credentials, clock, sshKeys } from "../../../tests/state-contract/authority.mjs";
import type { Consumer, Contract } from "../../../tests/state-contract/manifest";

export type Fault = "noCommit" | "noEvents" | "uiUnsubscribed" | "staleDetail" | "staleCatalog" | "wrongItem" | "remount" | "noInbound" | "staleFingerprint" | "staleAlgorithm";
export type Verdict = {persisted:boolean;notification:boolean;cold:boolean;lifecycle:boolean;mounted:Record<string,boolean>;derived?:Record<string,boolean>};
const invariant = (ok:unknown,why:string) => {if(!ok)throw Error(why);};
const get = (o:any,path:string):any => path.split(".").reduce((v,k)=>v?.[k],o);
export const put = (o:any,path:string,value:unknown) => {const keys=path.split(".");const last=keys.pop()!;let at=o;for(const k of keys)at=at[k]??={};at[last]=value;};
export const freshBackend = (authority:Authority) => new WebBackend({server:credentials.server,fetch:authority.fetch,deviceStorage:new MapStorage(),idle:null,now:()=>clock});
export const login = (backend:WebBackend) => backend.login({email:credentials.email,password:credentials.password});
export async function eventually(check:()=>void,timeout=3000) {
  const end=Date.now()+timeout;let error:unknown;
  do {
    await act(async()=>{await new Promise<void>(resolve=>setImmediate(resolve));
      // The DOM shim has no CSS animation clock. Complete only row exits;
      // never navigate, remount, refresh data, or inject backend changes.
      for(const row of document.querySelectorAll(".row.leave,.lrow.leave"))row.dispatchEvent(new Event("animationend",{bubbles:true}));
    });
    try {check();return;}catch(e){error=e;}
  } while(Date.now()<end);
  throw error;
}
function lines(item:string) {
  const slug={login:"contract-login",ssh:"contract-key",card:"contract-card",identity:"contract-identity",note:"contract-note"}[item];
  return {document:`personal › contract-folder › ${slug}`,catalog:"personal › contract-folder",search:"Contract",map:`personal › contract-folder › ${slug} map:${slug}`};
}
function row(host:HTMLElement,id:string) {return host.querySelector(`[data-id="item:${id}"] .lbl`);}
function documentText(host:HTMLElement) {return host.querySelector(".insp > .doc:not(.ghost)")?.textContent??"";}
function consumerValue(kind:Consumer,hosts:Record<string,HTMLElement>,c:Contract):string {
  if(kind==="document" || kind==="security")return documentText(hosts.document!);
  if(kind==="catalog")return row(hosts.catalog!,c.item)?.textContent??"";
  if(kind==="search")return [...hosts.search!.querySelectorAll(".lrow .lbl")].map(e=>e.textContent).join("\n");
  if(kind==="breadcrumbs")return hosts.document!.querySelector(".strip")?.textContent??"";
  return hosts.map!.querySelector(".mnodes")?.textContent??"";
}
export class Harness {
  readonly authority=new Authority();
  readonly backend=freshBackend(this.authority);
  readonly events:Change[]=[];
  readonly observations:string[]=[];
  readonly hosts:Record<string,HTMLElement>={};
  private readonly roots:Root[]=[];
  private readonly anchors=new Map<string,Element>();
  private readonly before=new Map<string,string>();
  private off:()=>void=()=>{};
  private uiBackend!:Backend;
  private draft!:ItemDraft;
  expected:any;
  constructor(readonly contract:Contract,readonly fault?:Fault) {}
  async open() {
    Object.defineProperty(globalThis,"crypto",{value:webcrypto,configurable:true});
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
    setLang(Lang.En);
    await login(this.backend);
    const initialCatalog=await this.backend.catalog();
    const initialDetail=await this.backend.item(this.contract.item);
    this.draft=draftOf(formFromDetail(initialDetail));
    this.expected=this.authority.read(this.contract.item);
    if(this.contract.id==="ssh.material")this.expected.sshKey={privateKey:sshKeys[1]!.privateKey,publicKey:sshKeys[1]!.publicKey,keyFingerprint:sshKeys[1]!.fingerprint};
    else put(this.expected,this.contract.path,this.contract.value);
    this.authority.ackWithoutCommit=this.fault==="noCommit";
    this.off=this.fault==="noEvents"?()=>{}:this.backend.subscribe(e=>this.events.push(this.fault==="wrongItem" && e.kind===ChangeKind.Item?{...e,id:"wrong-item"}:e));
    const self=this;
    this.uiBackend=new Proxy(this.backend,{get(target,key){
      if(key==="subscribe" && ["noEvents","uiUnsubscribed"].includes(self.fault??""))return ()=>()=>{};
      if(key==="catalog" && self.fault==="staleCatalog")return async()=>initialCatalog;
      if(key==="item" && self.fault==="staleDetail")return async()=>initialDetail;
      if(key==="item" && ["staleFingerprint","staleAlgorithm"].includes(self.fault??""))return async(id:string)=>{
        const d=await target.item(id);const field=self.fault==="staleFingerprint"?"fingerprint":"algorithm";
        return {...d,fields:d.fields.map(f=>f.key===field?{...f,value:self.fault==="staleFingerprint"?sshKeys[0]!.fingerprint:sshKeys[0]!.algorithm}:f)};
      };
      const value=Reflect.get(target,key,target);return typeof value==="function"?value.bind(target):value;
    }});
    for(const [name,line] of Object.entries(lines(this.contract.item))){
      if(name==="map" && !this.contract.consumers.includes("map"))continue;
      const host=document.createElement("div");document.body.append(host);this.hosts[name]=host;
      const root=createRoot(host);this.roots.push(root);
      act(()=>root.render(<App backend={this.uiBackend} writes={this.backend} line={line} autoBiometric={false}/>));
    }
    await eventually(()=>invariant(documentText(this.hosts.document!).includes(this.expected.name===initialDetail.item.name?initialDetail.item.name:this.authority.read(this.contract.item).name),"initial document not ready"));
    await eventually(()=>invariant(!this.hosts.document!.querySelector(".insp > .doc:not(.ghost) .sk"),"initial detail still loading"));
    // Wait for every declared consumer's initial concrete projection.
    await eventually(()=>{for(const consumer of this.contract.consumers){const value=consumerValue(consumer,this.hosts,this.contract);invariant(value.length>0,"initial "+consumer+" absent");}});
    await eventually(()=>this.settled());
    for(const [name,host] of Object.entries(this.hosts)){
      for(const selector of [".window",".insp > .doc:not(.ghost)"]){const anchor=host.querySelector(selector);invariant(anchor,"projection absent "+name);this.anchors.set(name+"|"+selector,anchor!);}
    }
    for(const consumer of this.contract.consumers){this.assertBefore(consumer);this.before.set(consumer,consumerValue(consumer,this.hosts,this.contract));}
    this.events.length=0;
  }
  private nextDraft():ItemDraft {
    const d=structuredClone(this.draft),c=this.contract;
    if(c.id==="item.name")d.name=String(c.value);
    else if(c.id==="item.folder")d.folderId=String(c.value);
    else if(c.id==="item.notes")d.notes={clear:true};
    else if(c.id==="ssh.material")d.fields=[{key:"privateKey",secret:{set:this.expected.sshKey.privateKey}},{key:"publicKey",value:this.expected.sshKey.publicKey},{key:"fingerprint",value:this.expected.sshKey.keyFingerprint}];
    else {const key=c.path.split(".").at(-1)!;d.fields=d.fields.filter(f=>!("key" in f && f.key===key));d.fields.push(key==="password"?{key,secret:{set:String(c.value)}}:{key,value:String(c.value)});}
    return d;
  }
  async mutate(source:"write"|"external"="write") {
    if(source==="external"){
      this.authority.external(this.contract.item,plain=>Object.assign(plain,this.expected));
      if(this.fault!=="noInbound")await act(async()=>{await this.backend.sync();});
    }else await act(async()=>{await this.backend.update(this.contract.item,this.nextDraft());});
    if(this.fault==="remount"){
      await act(async()=>{
        this.roots[0]!.unmount();const root=createRoot(this.hosts.document!);this.roots[0]=root;
        root.render(<App backend={this.uiBackend} writes={this.backend} line={lines(this.contract.item).document} autoBiometric={false}/>);
        await new Promise<void>(resolve=>setImmediate(resolve));
      });
    }
  }
  probe(consumer:Consumer):boolean {
    const actual=consumerValue(consumer,this.hosts,this.contract),old=this.before.get(consumer)!;
    if(this.contract.id==="item.notes")return actual.includes("The note is empty") && actual!==old;
    if(this.contract.id==="ssh.material"){
      const fingerprint=this.expected.sshKey.keyFingerprint;
      return actual.includes(fingerprint) && !actual.includes(sshKeys[0]!.fingerprint) && (consumer!=="document" || Object.values(this.derived()).every(Boolean));
    }
    if(this.contract.id==="item.folder"){
      if(consumer==="catalog")return !row(this.hosts.catalog!,this.contract.item);
      return actual.includes("Other folder") && actual!==old;
    }
    if(this.contract.id==="login.password")return actual.includes("Peer login") && actual!==old;
    return actual.includes(String(this.contract.value)) && actual!==old;
  }
  private assertBefore(consumer:Consumer){
    const actual=consumerValue(consumer,this.hosts,this.contract),plain=this.authority.read(this.contract.item);
    if(this.contract.id==="ssh.material"){
      invariant(actual.includes(sshKeys[0]!.fingerprint),"initial SSH fingerprint");
      if(consumer==="document")invariant(actual.includes(sshKeys[0]!.publicKey)&&actual.includes(sshKeys[0]!.algorithm),"initial SSH public/algorithm");
    }else if(this.contract.id==="item.notes")invariant(actual.includes("Notes")&&!actual.includes("The note is empty"),"initial nonempty note");
    else if(this.contract.id==="login.password")invariant(consumer==="security"?actual.includes("Password is unique"):!actual.includes("Peer login"),"initial password projections");
    else if(this.contract.id==="item.folder")invariant(actual.includes(consumer==="catalog"?plain.name:"Contract folder"),"initial folder projections");
    else invariant(actual.includes(String(get(plain,this.contract.path))),"initial concrete value in "+consumer);
  }
  async inspect(timeout=1500):Promise<Verdict> {
    // No checkpoint controls another. Missing events do not skip DOM or
    // persistence checks; no read here refreshes the mounted client.
    const persisted=this.persisted();
    const notification=this.events.some(e=>e.kind===ChangeKind.Item && e.id===this.contract.item) || (this.observations.includes("external") && this.events.some(e=>e.kind===ChangeKind.Catalog));
    const mounted:Record<string,boolean>={};
    try{await eventually(()=>{this.settled();for(const consumer of this.contract.consumers)invariant(this.probe(consumer),consumer+" stale");},timeout);}catch{}
    for(const consumer of this.contract.consumers)mounted[consumer]=this.probe(consumer);
    const cold=freshBackend(this.authority);let coldOK=false;
    try{await act(async()=>{await login(cold);const detail=await cold.item(this.contract.item);
      if(this.contract.id==="item.name")coldOK=detail.item.name===this.contract.value;
      else if(this.contract.id==="item.folder")coldOK=detail.item.folderId===this.contract.value;
      else if(this.contract.id==="login.password"){const r=await cold.reveal({itemId:this.contract.item,field:SecretField.Password});try{coldOK=r.value===this.contract.value;}finally{r.drop();}}
      else if(this.contract.id==="ssh.material")coldOK=detail.fields.some(f=>f.key==="fingerprint" && f.value===this.expected.sshKey.keyFingerprint) && detail.fields.some(f=>f.key==="publicKey" && f.value===this.expected.sshKey.publicKey) && detail.fields.some(f=>f.key==="algorithm" && f.value===sshKeys[1]!.algorithm);
      else if(this.contract.id==="item.notes")coldOK=detail.notes===null;
      else coldOK=detail.fields.some(f=>f.value===this.contract.value);
    });
    }catch{coldOK=false;}finally{await act(async()=>{await cold.lock();});}
    const lifecycle=[...this.anchors].every(([key,anchor])=>{const [name,selector]=key.split("|");return this.hosts[name!]!.querySelector(selector!)===anchor;});
    return {persisted,notification,mounted,cold:coldOK,lifecycle,...(this.contract.id==="ssh.material"?{derived:this.derived()}:{})};
  }
  derived(){
    const field=(label:string)=>[...this.hosts.document!.querySelectorAll(".insp > .doc:not(.ghost) .f")].find(f=>f.querySelector(".k")?.textContent?.trim()===label)?.querySelector(".v")?.textContent?.trim();
    return {publicKey:field("Public key")===this.expected.sshKey.publicKey,fingerprint:field("Fingerprint")===this.expected.sshKey.keyFingerprint,algorithm:field("Algorithm")===sshKeys[1]!.algorithm};
  }
  persisted() {const now=this.authority.read(this.contract.item);return this.contract.id==="ssh.material"?JSON.stringify(now.sshKey)===JSON.stringify(this.expected.sshKey):JSON.stringify(get(now,this.contract.path))===JSON.stringify(this.contract.value);}
  async external(){this.observations.push("external");await this.mutate("external");}
  async reject(){this.authority.rejectWrites=true;const before=this.authority.read(this.contract.item);let refused=false;await act(async()=>{try{await this.backend.update(this.contract.item,this.nextDraft());}catch(e){refused=isWebError(e,"err.serverAnswered")&&e.args.status===500;}});return {refused,persistedUnchanged:JSON.stringify(before)===JSON.stringify(this.authority.read(this.contract.item))};}
  snapshot(){return Object.fromEntries(this.contract.consumers.map(c=>[c,consumerValue(c,this.hosts,this.contract)]));}
  private settled(){invariant(Object.values(this.hosts).every(host=>!host.querySelector('.activity[aria-busy="true"]')),"client reads still pending");}
  async close(){await act(async()=>{for(const root of this.roots)root.unmount();this.off();await this.backend.lock();});for(const host of Object.values(this.hosts))host.remove();}
}
