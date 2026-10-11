// @vitest-environment happy-dom
import { afterEach, beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import { Harness, type Fault } from "./harness";
import { contracts } from "../../../tests/state-contract/manifest";
import { PathStore } from "../../../ui/core/src/path/store";
vi.mock("../../../ui/core/src/ui/tokens",()=>({tokenPx:()=>320}));
const errors:unknown[]=[];
const executed=new Set<string>();
beforeAll(()=>{
  Object.defineProperty(document,"fonts",{value:{ready:Promise.resolve(),status:"loaded",addEventListener:()=>{},removeEventListener:()=>{}},configurable:true});
  vi.stubGlobal("reportError",(e:unknown)=>errors.push(e));
  vi.spyOn(console,"error").mockImplementation((...args)=>errors.push(args.map(String).join(" ")));
  // happy-dom has no layout engine. Supply geometry, not models, names,
  // events, subscriptions, state, or expected consumer data.
  vi.spyOn(HTMLElement.prototype,"getBoundingClientRect").mockImplementation(function(this:HTMLElement){
    const probe=this.style.width.startsWith("var(");
    return new DOMRect(0,0,probe?64:960,probe?0:600);
  });
});
afterAll(()=>{
  vi.restoreAllMocks();vi.unstubAllGlobals();
  if(process.env.KEYWARD_STATE_CONTRACT_COMPLETE==="1"){
    const required=contracts.flatMap(c=>["write","external","refusal"].map(source=>c.id+":"+source));
    expect(required.filter(key=>!executed.has(key)),"Every registered contract must execute its assertions in the full CI run").toEqual([]);
  }
});
let current:Harness|null=null;
afterEach(async()=>{await current?.close();current=null;expect(errors.splice(0)).toEqual([]);});
async function opened(id:string,fault?:Fault){current=new Harness(contracts.find(c=>c.id===id)!,fault);await current.open();return current;}
describe("state mutation consistency",()=>{
  for(const c of contracts){
    it(c.id+": persistence, notification, mounted consumers and independent cold read",async()=>{
      const h=await opened(c.id);await h.mutate();
      expect(await h.inspect()).toEqual({persisted:true,notification:true,cold:true,lifecycle:true,mounted:Object.fromEntries(c.consumers.map(x=>[x,true])),...(c.id==="ssh.material"?{derived:{publicKey:true,fingerprint:true,algorithm:true}}:{})});
      executed.add(c.id+":write");
    });
    it(c.id+": external commit through the real sync ingress",async()=>{
      const h=await opened(c.id);await h.external();
      expect(await h.inspect()).toEqual({persisted:true,notification:true,cold:true,lifecycle:true,mounted:Object.fromEntries(c.consumers.map(x=>[x,true])),...(c.id==="ssh.material"?{derived:{publicKey:true,fingerprint:true,algorithm:true}}:{})});
      executed.add(c.id+":external");
    });
    it(c.id+": refusal leaves authoritative state and mounted consumers unchanged",async()=>{
      const h=await opened(c.id);const before=h.snapshot();
      expect(await h.reject()).toEqual({refused:true,persistedUnchanged:true});
      expect(h.events).toEqual([]);
      expect(h.snapshot()).toEqual(before);
      executed.add(c.id+":refusal");
    });
  }
});
describe("the harness must detect separated failures",()=>{
  it("detects a restoration of the original rebase-from-old-slug bug through the real write path",async()=>{
    const spy=vi.spyOn(PathStore.prototype,"rebase").mockImplementation(function(this:PathStore,query,notify=true){
      // Fault injection: the old production algorithm, deliberately restored.
      const self=this as any;self.query=query;const state=query.compile(self.snap.line);
      self.history[self.at]=query.serialize(state);
      if(notify)self.set(state,self.snap.focus);else self.snap={...self.snap,state,line:query.serialize(state)};
    });
    try{
      const h=await opened("item.name");await h.mutate();const v=await h.inspect(80);
      expect(v.persisted).toBe(true);expect(v.notification).toBe(true);expect(v.cold).toBe(true);
      expect(v.mounted.catalog).toBe(true);expect(v.mounted.document).toBe(false);expect(v.mounted.map).toBe(false);
    }finally{spy.mockRestore();}
  });
  it("an acknowledged write that never commits fails persistence",async()=>{
    const h=await opened("login.username","noCommit");await h.mutate();const v=await h.inspect(40);
    expect(v.persisted).toBe(false);expect(v.notification).toBe(true);expect(v.cold).toBe(false);expect(v.mounted.document).toBe(false);
  });
  it("a persisted write with suppressed notifications fails notification and mounted UI independently",async()=>{
    const h=await opened("login.username","noEvents");await h.mutate();const v=await h.inspect(40);
    expect(v.persisted).toBe(true);expect(v.cold).toBe(true);expect(v.notification).toBe(false);expect(v.mounted.document).toBe(false);
  });
  it("a working observer cannot cover a disconnected App subscription",async()=>{
    const h=await opened("login.username","uiUnsubscribed");await h.mutate();const v=await h.inspect(40);
    expect(v.persisted).toBe(true);expect(v.notification).toBe(true);expect(v.mounted.document).toBe(false);expect(v.mounted.catalog).toBe(false);
  });
  it("a stale item read fails the document while catalog and search update",async()=>{
    const h=await opened("login.username","staleDetail");await h.mutate();const v=await h.inspect(40);
    expect(v.notification).toBe(true);expect(v.mounted.document).toBe(false);expect(v.mounted.catalog).toBe(true);expect(v.mounted.search).toBe(true);
  });
  it("a stale catalogue is detected separately from persistence",async()=>{
    const h=await opened("login.username","staleCatalog");await h.mutate();const v=await h.inspect(40);
    expect(v.persisted).toBe(true);expect(v.notification).toBe(true);expect(v.mounted.catalog).toBe(false);
  });
  it("a wrong Item id fails notification even if the global App reload happens to update UI",async()=>{
    const h=await opened("login.username","wrongItem");await h.mutate();const v=await h.inspect();
    expect(v.notification).toBe(false);expect(v.persisted).toBe(true);expect(v.mounted.document).toBe(true);
  });
  it("an external commit with no sync delivery leaves active projections old",async()=>{
    const h=await opened("login.username","noInbound");await h.external();const v=await h.inspect(40);
    expect(v.persisted).toBe(true);expect(v.cold).toBe(true);expect(v.notification).toBe(false);expect(v.mounted.document).toBe(false);
  });
  it("a remount cannot pass as reactive consistency",async()=>{
    const h=await opened("login.username","remount");await h.mutate();const v=await h.inspect();
    expect(v.mounted.document).toBe(true);expect(v.lifecycle).toBe(false);
  });
  for(const [fault,field] of [["staleFingerprint","fingerprint"],["staleAlgorithm","algorithm"]] as const){
    it("detects stale SSH "+field+" even when the public key is new",async()=>{
      const h=await opened("ssh.material",fault);await h.external();const v=await h.inspect(80);
      expect(v.persisted).toBe(true);expect(v.notification).toBe(true);expect(v.cold).toBe(true);
      expect(v.derived!.publicKey).toBe(true);expect(v.derived![field]).toBe(false);expect(v.mounted.document).toBe(false);
    });
  }
});
