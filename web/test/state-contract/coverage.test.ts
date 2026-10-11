import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { contracts, deferred, operations } from "../../../tests/state-contract/manifest";
import { inventory, audit } from "../../../scripts/state-contract-coverage.mjs";
const probes=["document","catalog","search","breadcrumbs","map","security"];
describe("the mutation registry's declared coverage boundary",()=>{
  it("classifies every ItemDraft member, editable kind field and Writes operation",()=>{
    expect(audit(inventory(),contracts,deferred,operations,probes).errors).toEqual([]);
  });
  it("fails on a new DTO member even when both hand-written lists forget it",()=>{
    const file="ui/core/src/writes.ts";
    const text=fs.readFileSync(new URL("../../../ui/core/src/writes.ts",import.meta.url),"utf8").replace("export type ItemDraft = {","export type ItemDraft = {\n newlyWritable: string;");
    expect(audit(inventory({[file]:text}),contracts,deferred,operations,probes).errors).toContain("Unclassified writable field: ItemDraft.newlyWritable");
  });
  it("fails on a new write operation",()=>{
    const file="ui/core/src/writes.ts";
    const text=fs.readFileSync(new URL("../../../ui/core/src/writes.ts",import.meta.url),"utf8").replace("export interface Writes {","export interface Writes {\n newMutation(): Promise<void>;");
    expect(audit(inventory({[file]:text}),contracts,deferred,operations,probes).errors).toContain("Unclassified operation: newMutation");
  });
  it("fails on a new generic field",()=>{
    const file="ui/core/src/edit/draft.ts";
    const text=fs.readFileSync(new URL("../../../ui/core/src/edit/draft.ts",import.meta.url),"utf8").replace("[ItemKind.Login]: [","[ItemKind.Login]: [{ key: 'newLoginField', label: 'field.username' },");
    expect(audit(inventory({[file]:text}),contracts,deferred,operations,probes).errors).toContain("Unclassified writable field: fields.login.newLoginField");
  });
  it("fails for removed surfaces and for declared consumers with no actual probe",()=>{
    expect(audit({fields:[],methods:[]},contracts,deferred,operations,probes).errors.some(e=>e.startsWith("Stale field"))).toBe(true);
    expect(audit(inventory(),contracts,deferred,operations,[]).errors).toContain("item.name: no probe document");
  });
  it("fails closed when a boundary disappears instead of accepting an empty inventory",()=>{
    const file="ui/core/src/writes.ts";
    const text=fs.readFileSync(new URL("../../../ui/core/src/writes.ts",import.meta.url),"utf8");
    expect(()=>inventory({[file]:text.replace("export type ItemDraft = {","export type OtherDraft = {")})).toThrow("write boundary");
    expect(()=>inventory({[file]:text.replace("export interface Writes {","export interface OtherWrites {")})).toThrow("write boundary");
    expect(()=>inventory({[file]:text.replace("export interface Writes {","export interface Writes extends OtherWrites {")})).toThrow("Inherited Writes");
  });
  it("fails closed for spreads, dynamic field keys and computed kind schemas",()=>{
    const file="ui/core/src/edit/draft.ts";
    const text=fs.readFileSync(new URL("../../../ui/core/src/edit/draft.ts",import.meta.url),"utf8");
    expect(()=>inventory({[file]:text.replace("[ItemKind.Login]: [","...newKinds, [ItemKind.Login]: [")})).toThrow("Unsupported field schema");
    expect(()=>inventory({[file]:text.replace('key: "username"','key: aRuntimeKey')})).toThrow("Dynamic key");
    expect(()=>inventory({[file]:text.replace("[ItemKind.Login]: [","[aRuntimeKind()]: [")})).toThrow("computed kind");
  });
});
