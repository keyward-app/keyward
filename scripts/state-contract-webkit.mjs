// Semantic E2E, separate from screenshot comparison. No DemoBackend and no
// direct emit: browser -> real App/Writes -> HTTP authority -> subscriptions.
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import {webkit} from 'playwright-core';
import {Authority,credentials,clock,sshKeys} from '../tests/state-contract/authority.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const server=await createServer({root,configFile:false,plugins:[react()],resolve:{alias:[{find:/^@keyward\/core\/(.*)$/,replacement:path.join(root,'ui/core/src/$1')},{find:'@keyward/core',replacement:path.join(root,'ui/core/src/index.ts')}]},server:{host:'127.0.0.1',port:0,watch:{ignored:['**/dist/**','**/target/**']}}});
await server.listen();
const url=`http://127.0.0.1:${server.httpServer.address().port}/tests/state-contract/browser.html`;
let browser;
const failures=[];
async function pageFor(authority,ssh=false){
  const page=await browser.newPage({viewport:{width:1600,height:1200}});
  page.on('pageerror',e=>failures.push(e.message));
  page.on('console',m=>{if(m.type()==='error'){
    const expectedRefusal=authority.rejectWrites && (/status of 500/.test(m.text()) || /^Error: Not saved: The server answered 500/.test(m.text()));
    if(!expectedRefusal)failures.push(m.text());
  }});
  await page.route('https://contract.example/**',async route=>{
    const req=route.request();const r=authority.request({url:req.url(),method:req.method(),body:req.postData()||''});
    await route.fulfill({status:r.status,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:JSON.stringify(r.body)});
  });
  await page.goto(url);
  await page.waitForFunction(()=>!!window.stateContract);
  await page.evaluate(c=>window.stateContract.start(c),{...credentials,now:clock,ssh});
  await page.locator('#reader .insp .hero h1').waitFor();
  if(ssh)await page.locator('#reader .insp').getByText(sshKeys[0].fingerprint,{exact:true}).waitFor();
  else await page.locator('#writer input[aria-label="Name"]').waitFor();
  await page.waitForFunction(()=>[...document.querySelectorAll('.contract-view:not(#writer)')].every(e=>!!e.querySelector('.insp > .doc:not(.ghost)')));
  await page.evaluate(()=>window.stateContract.baseline());
  return page;
}
async function eventFor(page,id){await page.waitForFunction(id=>window.stateContract.changes().some(e=>e.kind==='item'&&e.id===id),id);}
try {
  browser=await webkit.launch();
  {
    const authority=new Authority();const page=await pageFor(authority);
    await page.locator('#writer input[aria-label="Name"]').fill('Renamed contract login');
    await page.locator('#writer').getByRole('button',{name:/^Save/}).click();
    await page.locator('#reader .insp .hero h1').getByText('Renamed contract login',{exact:true}).waitFor();
    await page.locator('#catalog [data-id="item:login"] .lbl .t').getByText('Renamed contract login',{exact:true}).waitFor();
    await page.locator('#search .lrow .lbl .t').getByText('Renamed contract login',{exact:true}).waitFor();
    await page.locator('#map .mnodes b').getByText('Renamed contract login',{exact:true}).waitFor();
    assert.equal(authority.read('login').name,'Renamed contract login');
    await eventFor(page,'login');
    assert.equal((await page.evaluate(()=>window.stateContract.cold('login'))).item.name,'Renamed contract login');
    assert.equal(await page.evaluate(()=>window.stateContract.lifecycle()),true);
    console.log('PASS rename: authority, notification, document/catalog/search/map, cold client, mounted lifetime');await page.close();
  }
  {
    const authority=new Authority();const page=await pageFor(authority);
    authority.external('login',p=>p.login.username='external-user');
    await page.locator('#reader .strip').getByRole('button',{name:/sync/i}).click();
    await page.locator('#reader .insp .f .v').getByText('external-user',{exact:true}).waitFor();
    await page.locator('#catalog [data-id="item:login"] .lbl .s').getByText('external-user',{exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>window.stateContract.lifecycle()),true);
    assert.equal((await page.evaluate(()=>window.stateContract.cold('login'))).fields.find(f=>f.key==='username').value,'external-user');
    assert((await page.evaluate(()=>window.stateContract.changes())).some(e=>e.kind==='catalog'));
    console.log('PASS external sync: server commit, product sync button, mounted document/list, cold client');await page.close();
  }
  {
    const authority=new Authority();const page=await pageFor(authority,true);
    authority.external('ssh',p=>p.sshKey={privateKey:sshKeys[1].privateKey,publicKey:sshKeys[1].publicKey,keyFingerprint:sshKeys[1].fingerprint});
    await page.locator('#reader .strip').getByRole('button',{name:/sync/i}).click();
    await page.locator('#reader .insp .f .v').getByText(sshKeys[1].fingerprint,{exact:true}).waitFor();
    await page.locator('#reader .insp .f .v').getByText(sshKeys[1].publicKey,{exact:true}).waitFor();
    await page.locator('#reader .insp .f .v').getByText(sshKeys[1].algorithm,{exact:true}).waitFor();
    await page.locator('#catalog [data-id="item:ssh"] .lbl .s').getByText(sshKeys[1].fingerprint,{exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>window.stateContract.lifecycle()),true);
    assert.equal((await page.evaluate(()=>window.stateContract.cold('ssh'))).fields.find(f=>f.key==='publicKey').value,sshKeys[1].publicKey);
    assert.equal(authority.read('ssh').sshKey.keyFingerprint,sshKeys[1].fingerprint);
    console.log('PASS SSH external material: public key, fingerprint, algorithm, catalog, cold client, mounted lifetime');await page.close();
  }
  {
    const authority=new Authority();const page=await pageFor(authority);authority.rejectWrites=true;
    await page.locator('#writer input[aria-label="Name"]').fill('Rejected name');
    await page.locator('#writer').getByRole('button',{name:/^Save/}).click();
    await page.locator('#writer').getByText(/Not saved:.*500/).waitFor();
    assert.equal(await page.locator('#reader .insp .hero h1').innerText(),'Contract login');
    assert.equal(authority.read('login').name,'Contract login');
    assert.equal((await page.evaluate(()=>window.stateContract.cold('login'))).item.name,'Contract login');
    assert.equal(await page.evaluate(()=>window.stateContract.lifecycle()),true);
    assert.equal((await page.evaluate(()=>window.stateContract.changes())).length,0);
    console.log('PASS refusal: visible save error, canonical document, server unchanged, cold client');await page.close();
  }
  assert.deepEqual(failures,[],'Browser console/page errors');
  console.log('4 WebKit mutation scenarios passed');
}finally{await browser?.close();await server.close();}
