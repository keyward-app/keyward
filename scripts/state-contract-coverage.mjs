// Compare the real write boundary with independent expectations. This finds
// additions/removals; it does not manufacture consumers from production code.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const source=(file,text=fs.readFileSync(path.join(root,file),'utf8'))=>{
  const parsed=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true);
  if(parsed.parseDiagnostics.length)throw Error('Invalid syntax in write boundary '+file);
  return parsed;
};
function declaration(file,name){let found;const walk=n=>{if(n.name?.text===name)found=n;ts.forEachChild(n,walk);};walk(source(file));if(!found)throw Error('No declaration '+name);return found;}
export function inventory(overrides={}) {
  const file='ui/core/src/writes.ts';const src=source(file,overrides[file]);
  const dto=src.statements.find(n=>ts.isTypeAliasDeclaration(n)&&n.name.text==='ItemDraft');
  const writes=src.statements.find(n=>ts.isInterfaceDeclaration(n)&&n.name.text==='Writes');
  if(!dto || !ts.isTypeLiteralNode(dto.type) || !writes)throw Error('The write boundary no longer has the expected schema; review the extractor.');
  if(writes.heritageClauses?.length)throw Error('Inherited Writes boundary needs explicit extraction; review the extractor.');
  const fields=dto.type.members.map(n=>{
    if(!ts.isPropertySignature(n)||!n.name||(!ts.isIdentifier(n.name)&&!ts.isStringLiteral(n.name)))throw Error('Unsupported ItemDraft member; review the extractor.');
    return 'ItemDraft.'+(n.name.text);
  });
  const methods=writes.members.map(n=>{
    if(!ts.isMethodSignature(n)||!n.name||!ts.isIdentifier(n.name))throw Error('Unsupported Writes member; review the extractor.');
    return n.name.text;
  });
  const kinds=declaration('ui/core/src/model/types.ts','ItemKind');
  const names=new Map(kinds.members.map(n=>[n.name.text,n.initializer.text]));
  const draft=source('ui/core/src/edit/draft.ts',overrides['ui/core/src/edit/draft.ts']);
  let specs;const walk=n=>{if(ts.isVariableDeclaration(n)&&n.name.getText(draft)==='KIND_FIELDS')specs=n.initializer;ts.forEachChild(n,walk);};walk(draft);
  if(!specs || !ts.isObjectLiteralExpression(specs))throw Error('KIND_FIELDS changed shape; review the extractor.');
  for(const kind of specs.properties){
    if(!ts.isPropertyAssignment(kind)||!ts.isComputedPropertyName(kind.name)||!ts.isArrayLiteralExpression(kind.initializer))throw Error('Unsupported field schema; do not silently skip it.');
    if(!ts.isPropertyAccessExpression(kind.name.expression)||kind.name.expression.expression.getText(draft)!=='ItemKind')throw Error('Unsupported computed kind; review the extractor.');
    const name=names.get(kind.name.expression.name.text);if(!name)throw Error('Unknown kind');
    for(const field of kind.initializer.elements){
      if(!ts.isObjectLiteralExpression(field))throw Error('Dynamic field schema needs explicit extraction.');
      const key=field.properties.find(n=>ts.isPropertyAssignment(n)&&n.name.getText(draft)==='key');
      const parts=field.properties.find(n=>ts.isPropertyAssignment(n)&&n.name.getText(draft)==='parts');
      if(parts){if(!ts.isArrayLiteralExpression(parts.initializer))throw Error('Dynamic parts');for(const part of parts.initializer.elements){if(!ts.isStringLiteral(part))throw Error('Dynamic part');fields.push(`fields.${name}.${part.text}`);}}
      else {if(!key || !ts.isStringLiteral(key.initializer))throw Error('Dynamic key');fields.push(`fields.${name}.${key.initializer.text}`);}
    }
  }
  return {fields:[...new Set(fields)].sort(),methods:methods.sort()};
}
export function audit(surface,manifest,knownDeferred,operations,probeNames) {
  const errors=[];const ids=new Set(manifest.map(c=>c.id));
  if(ids.size!==manifest.length)errors.push('Duplicate scenario id');
  const covered=new Map();
  for(const c of manifest){
    if(!c.consumers.length)errors.push(c.id+': no executable consumers');
    for(const consumer of c.consumers)if(!probeNames.includes(consumer))errors.push(c.id+': no probe '+consumer);
    for(const field of c.fields){if(!covered.has(field))covered.set(field,[]);covered.get(field).push(c.id);}
  }
  // ItemDraft.fields is the dynamic sum of the separately inventoried kinds.
  covered.set('ItemDraft.fields',[...ids]);
  // SSH derives public/fingerprint fields outside the generic KIND_FIELDS.
  const extra=['fields.ssh_key.privateKey','fields.ssh_key.publicKey','fields.ssh_key.fingerprint'];
  const expected=[...surface.fields,...extra];
  for(const field of expected)if(!covered.has(field)&&!knownDeferred[field])errors.push('Unclassified writable field: '+field);
  for(const field of [...covered.keys(),...Object.keys(knownDeferred)])if(!expected.includes(field))errors.push('Stale field requirement: '+field);
  for(const [field,reason] of Object.entries(knownDeferred)){
    if(!reason.trim())errors.push('No reason for deferred '+field);
    if(covered.has(field))errors.push('Both covered and deferred: '+field);
  }
  for(const method of surface.methods){const policy=operations[method];if(!policy)errors.push('Unclassified operation: '+method);else if(policy.contract?!ids.has(policy.contract):!policy.reason?.trim())errors.push('No executable contract or reason: '+method);}
  for(const method of Object.keys(operations))if(!surface.methods.includes(method))errors.push('Stale operation: '+method);
  return {errors,covered:[...covered.keys()].filter(k=>expected.includes(k)),deferred:Object.keys(knownDeferred),operations:surface.methods};
}
