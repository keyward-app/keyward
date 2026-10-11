import { describe, expect, it } from "vitest";
import { DEMO } from "../demo";
import { Directory, MapKind } from "./directory";
import { Query, isFilter } from "./query";
import { PathStore } from "./store";
import { CORE_VERBS } from "../verbs/core";
const query=(catalog=DEMO)=>new Query(new Directory(catalog),CORE_VERBS);
const renamed=(id:string,name:string)=>({...DEMO,items:DEMO.items.map(i=>i.id===id?{...i,name}:i)});
describe("a new graph keeps the open path's identity",()=>{
  it("updates the open document, map anchor and committed history after an item rename",()=>{
    const q=query();const id=q.dir.bySlugOrNull("aws-production")!;const item=q.dir.node(id).item!;
    const store=new PathStore(q,"personal › work");
    store.commit("personal › work › aws-production map:aws-production");
    store.rebase(query(renamed(item.id,"Renamed service")));
    expect(store.object()).toBe(id);
    expect(store.get().line).toContain("renamed-service");
    expect(store.get().line).not.toContain("aws-production");
    expect(store.get().state.map).toEqual({kind:MapKind.Relations,anchor:id});
    store.back();store.forward();
    expect(store.object()).toBe(id);
    expect(store.get().line).toContain("renamed-service");
  });
  it("keeps a filter instead of replacing it with the object's home",()=>{
    const q=query();const id=q.dir.bySlugOrNull("aws-production")!;
    const store=new PathStore(q,"kind:login › aws-production");
    store.rebase(query(renamed(q.dir.node(id).item!.id,"Renamed service")));
    expect(store.object()).toBe(id);
    expect(isFilter(store.get().state.segs[0]!)).toBe(true);
    expect(store.get().line).toContain("kind:login");
  });
  it("updates renamed parent crumbs without closing the item",()=>{
    const q=query();const id=q.dir.bySlugOrNull("aws-production")!;const item=q.dir.node(id).item!;
    const store=new PathStore(q,"personal › work › aws-production");
    store.rebase(query({...DEMO,folders:DEMO.folders.map(f=>f.id===item.folderId?{...f,name:"New folder"}:f)}));
    expect(store.object()).toBe(id);expect(store.get().line).toContain("new-folder");
  });
  it("drops a removed node and its map without turning the removed slug into a search",()=>{
    const q=query();const id=q.dir.bySlugOrNull("aws-production")!;const item=q.dir.node(id).item!;
    const store=new PathStore(q,"personal › work › aws-production map:aws-production");
    store.rebase(query({...DEMO,items:DEMO.items.filter(i=>i.id!==item.id)}));
    expect(store.get().line).not.toContain("aws-production");
    expect(store.get().state.map).toBeNull();
    expect(store.get().state.segs.every(s=>!isFilter(s))).toBe(true);
  });
  it("rebases an independent map anchor while retaining the selected object",()=>{
    const q=query();const id=q.dir.bySlugOrNull("aws-production")!;
    const item=q.dir.node(id).item!;
    const other=DEMO.items.find(i=>i.id!==item.id && i.reuseGroup===item.reuseGroup)!;
    const store=new PathStore(q,`personal › work › aws-production map:${q.dir.node(`item:${other.id}`).slug}`);
    const anchor=store.get().state.map!.anchor;
    store.rebase(query(renamed(other.id,"Renamed anchor")));
    expect(store.object()).toBe(id);expect(store.get().state.map!.anchor).toBe(anchor);
    expect(store.get().line).toContain("map:renamed-anchor");
  });
  it("closes an unavailable independent map anchor while keeping a surviving document",()=>{
    const q=query();const id=q.dir.bySlugOrNull("aws-production")!;
    const item=q.dir.node(id).item!;
    const other=DEMO.items.find(i=>i.id!==item.id && i.reuseGroup===item.reuseGroup)!;
    const store=new PathStore(q,`personal › work › aws-production map:${q.dir.node(`item:${other.id}`).slug}`);
    expect(store.object()).toBe(id);
    store.rebase(query({...DEMO,items:DEMO.items.filter(i=>i.id!==other.id)}));
    expect(store.object()).toBe(id);expect(store.get().state.map).toBeNull();
  });
  it("keeps a moved item selected and canonicalizes its new home",()=>{
    const q=query();const id=q.dir.bySlugOrNull("aws-production")!;const item=q.dir.node(id).item!;
    const folder=DEMO.folders.find(f=>f.id!==item.folderId)!;
    const store=new PathStore(q,"personal › work › aws-production");
    const next=query({...DEMO,items:DEMO.items.map(i=>i.id===item.id?{...i,folderId:folder.id}:i)});
    store.rebase(next);
    expect(store.object()).toBe(id);
    expect(store.get().state.segs).toEqual(next.dir.node(id).home.map(id=>({id})));
  });
  it("keeps literal search predicates unchanged after a rename",()=>{
    const q=query();const id=q.dir.bySlugOrNull("aws-production")!;
    const store=new PathStore(q,"production");const before=store.get().line;
    store.rebase(query(renamed(q.dir.node(id).item!.id,"Renamed service")));
    expect(store.get().line).toBe(before);expect(isFilter(store.get().state.segs[0]!)).toBe(true);
  });
  it("is semantically idempotent over repeated refreshes",()=>{
    const store=new PathStore(query(),"kind:login › aws-production map:aws-production");
    const before=JSON.stringify(store.get().state);const line=store.get().line;
    store.rebase(query());store.rebase(query());
    expect(JSON.stringify(store.get().state)).toBe(before);expect(store.get().line).toBe(line);
  });
  it("updates both directions of history while positioned behind the latest entry",()=>{
    const q=query();const id=q.dir.bySlugOrNull("aws-production")!;
    const store=new PathStore(q,"personal");store.commit("personal › work › aws-production");store.commit("personal › work");store.back();
    store.rebase(query(renamed(q.dir.node(id).item!.id,"Renamed service")));
    expect(store.object()).toBe(id);store.forward();store.back();expect(store.object()).toBe(id);expect(store.get().line).toContain("renamed-service");
  });
});
