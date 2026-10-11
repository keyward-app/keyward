// Real daemon/CLI/Keychain integration against an independent synthetic server.
// Never reads the user's accounts: accounts and device ID are seeded first.
import assert from 'node:assert/strict';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const binary = resolve(process.argv[2] || repo + '/target/debug/keyward');
const sshKeys = [{},{}];
const delay = ms => new Promise(r => setTimeout(r, ms));
function run(command, args, env, input) {
  return new Promise((yes, no) => {
    const child = spawn(command, args, {env, stdio:['pipe','pipe','pipe']});
    let out = '';
    child.stdout.on('data', b => out += b);
    child.stderr.on('data', b => out += b);
    const timer = setTimeout(() => child.kill('SIGKILL'), 60000);
    child.on('error', no);
    child.on('close', code => {clearTimeout(timer); code === 0 ? yes(out) : no(Error(`${args[0]} exited ${code}: ${out}`));});
    child.stdin.end(input);
  });
}
for (const mode of ['pbkdf2', 'argon2']) {
  const fixture = JSON.parse(await fs.readFile(`${repo}/crates/vault/tests/fixtures/crypto-${mode === 'argon2' ? 'argon2-' : ''}compat.json`));
  const home = await fs.mkdtemp('/private/tmp/kw-native-');
  const env = {...process.env, KEYWARD_HOME:home};
  let daemon, keyName, server;
  let generation = 0, refreshes = 0, unauthorized = false, refused = false;
  const user = Buffer.from(fixture.user, 'base64');
  const seal = value => {
    const iv = crypto.randomBytes(16), c = crypto.createCipheriv('aes-256-cbc', user.subarray(0,32), iv);
    const ct = Buffer.concat([c.update(value), c.final()]);
    const mac = crypto.createHmac('sha256', user.subarray(32)).update(Buffer.concat([iv,ct])).digest();
    return `2.${iv.toString('base64')}|${ct.toString('base64')}|${mac.toString('base64')}`;
  };
  const open = value => {
    const [iv,ct,mac]=value.slice(2).split('|').map(x=>Buffer.from(x,'base64'));
    const expected=crypto.createHmac('sha256',user.subarray(32)).update(Buffer.concat([iv,ct])).digest();
    assert.ok(crypto.timingSafeEqual(mac,expected));
    const d=crypto.createDecipheriv('aes-256-cbc',user.subarray(0,32),iv);
    return Buffer.concat([d.update(ct),d.final()]).toString();
  };
  const token = () => `e30.${Buffer.from(JSON.stringify({exp:Math.floor(Date.now()/1000)+3600, generation:refreshes})).toString('base64url')}.sig`;
  const master = mode === 'pbkdf2'
    ? crypto.pbkdf2Sync(fixture.password, fixture.email, fixture.iterations, 32, 'sha256')
    : crypto.argon2Sync('argon2id', {message:fixture.password, nonce:crypto.createHash('sha256').update(fixture.email).digest(), memory:fixture.memoryMiB*1024, passes:fixture.iterations, parallelism:fixture.parallelism, tagLength:32});
  const passwordHash = crypto.pbkdf2Sync(master, fixture.password, 1, 32, 'sha256').toString('base64');
  const snapshot = () => ({
    profile:{id:'native-user', email:fixture.email, key:fixture.protectedKey, privateKey:fixture.protectedPrivateKey, organizations:[]},
    folders:[], collections:[], ciphers:[{
      id:'native-ssh', type:5, name:seal(`Native key ${generation}`), favorite:false, reprompt:0,
      sshKey:Object.fromEntries(Object.entries({privateKey:sshKeys[generation].privateKey, publicKey:sshKeys[generation].publicKey, keyFingerprint:sshKeys[generation].fingerprint}).map(([k,v])=>[k,seal(v)])),
      fields:[{name:seal('kw-host'),value:seal('native.contract.test'),type:0}],
    }],
  });
  const cli = (...args) => run(binary, args, env);
  const password = (op, value=fixture.password) => run('python3', [repo+'/scripts/native-vault-password.py',binary,op],env,value+'\n');
  const stop = async () => {
    if (!daemon) return;
    const child = daemon; daemon = null;
    if(child.exitCode !== null || child.signalCode !== null) return;
    await new Promise(done => {child.once('close',done); child.kill('SIGTERM');});
  };
  const start = async source => {
    daemon = spawn(binary,['daemon','--source',source],{env,stdio:'ignore'});
    for(let i=0;i<100;i++) {
      try {await cli('status');return;} catch {await delay(100);}
    }
    throw Error('daemon did not become ready');
  };
  try {
    // OpenSSH is the supported Ed25519 private-key representation.
    for(const [index,kind] of ['ed25519','rsa'].entries()) {
      await run('ssh-keygen',['-q','-t',kind,'-b','2048','-N','','-f',home+'/'+kind],env);
      sshKeys[index].privateKey=await fs.readFile(home+'/'+kind,'utf8');
      sshKeys[index].publicKey=(await fs.readFile(home+'/'+kind+'.pub','utf8')).trim().split(' ').slice(0,2).join(' ');
      sshKeys[index].fingerprint='SHA256:'+crypto.createHash('sha256').update(Buffer.from(sshKeys[index].publicKey.split(' ')[1],'base64')).digest('base64').replace(/=+$/,'');
    }
    server = http.createServer(async(req,res)=>{
      let body='';for await(const b of req)body+=b;
      let status=200, result;
      if(req.url.endsWith('/accounts/prelogin')) result={kdf:mode==='argon2'?1:0,kdfIterations:fixture.iterations,kdfMemory:fixture.memoryMiB,kdfParallelism:fixture.parallelism};
      else if(req.url.endsWith('/connect/token')) {
        const form=new URLSearchParams(body);
        if(form.get('grant_type')==='refresh_token') {
          if(form.get('refresh_token')!==`refresh-${refreshes}`) {status=400;result={error:'invalid_grant'};}
          else {refreshes++;result={access_token:token(),refresh_token:`refresh-${refreshes}`};}
        } else if(form.get('password')===passwordHash) result={access_token:token(),refresh_token:'refresh-0',Key:fixture.protectedKey,PrivateKey:fixture.protectedPrivateKey};
        else {status=400;result={error_description:'invalid_username_or_password'};}
      } else if(req.url.startsWith('/api/sync')) {
        if(refused){status=500;result={message:'synthetic refusal'};}
        else if(unauthorized){unauthorized=false;status=401;result={};}
        else result=snapshot();
      } else {status=404;result={};}
      res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(result));
    });
    await new Promise(r=>server.listen(0,'127.0.0.1',r));
    const url=`http://127.0.0.1:${server.address().port}`, id=`${fixture.email}@${url}`;
    keyName=crypto.createHash('sha256').update('keyward account\0'+id).digest('hex').slice(0,32);
    await fs.writeFile(home+'/accounts.json',JSON.stringify({accounts:[{id,base_url:url,email:fixture.email,identity_url:url+'/identity'}],active:id}));
    await fs.writeFile(home+'/device-id',crypto.randomUUID());
    await fs.writeFile(home+'/mappings.json','[]');
    await start('file');
    await cli('plugin','install',repo+'/dist/packages/ssh');
    await cli('plugin','enable','ssh');
    await stop();await start('vault');
    await password('login');
    const persisted = async () => {
      const key=Buffer.from((await run('security',['find-generic-password','-s','keyward-session','-a',keyName,'-w'],env)).trim(),'base64');
      const data=await fs.readFile(`${home}/session-${keyName}.json`);
      assert.equal(data.subarray(0,8).toString(),'kwsess1\n');
      const d=crypto.createDecipheriv('aes-256-gcm',key,data.subarray(8,20));
      d.setAAD(Buffer.from('keyward session v1\n'+id));d.setAuthTag(data.subarray(-16));
      return JSON.parse(Buffer.concat([d.update(data.subarray(20,-16)),d.final()]));
    };
    const signing = async index => {
      await cli('resolve','native.contract.test','','0');
      const sshEnv={...env,SSH_AUTH_SOCK:home+'/s/native.contract.test.sock'};
      const identities=await run('ssh-add',['-L'],sshEnv);
      assert.ok(identities.includes(sshKeys[index].publicKey));
      await fs.writeFile(home+'/expected.pub',sshKeys[index].publicKey+'\n');
      await run('ssh-add',['-T',home+'/expected.pub'],sshEnv);
    };
    assert.equal((await persisted()).snapshot.ciphers.length,1);
    await signing(0);
    generation=1;unauthorized=true;await cli('sync');
    const saved=await persisted();
    assert.equal(refreshes,1);assert.equal(saved.refresh_token,'refresh-1');
    assert.equal(open(saved.snapshot.ciphers[0].name),'Native key 1');
    assert.equal(open(saved.snapshot.ciphers[0].sshKey.publicKey),sshKeys[1].publicKey);
    assert.equal(open(saved.snapshot.ciphers[0].sshKey.keyFingerprint),sshKeys[1].fingerprint);
    assert.ok((await cli('hosts')).includes('Native key 1'));
    await signing(1);
    const before=await fs.readFile(`${home}/session-${keyName}.json`);
    refused=true;await assert.rejects(cli('sync'));refused=false;
    assert.deepEqual(await fs.readFile(`${home}/session-${keyName}.json`),before);
    await signing(1);
    await cli('lock');
    await assert.rejects(run('ssh-add',['-T',home+'/expected.pub'],{...env,SSH_AUTH_SOCK:home+'/s/native.contract.test.sock'}));
    await stop();await start('vault');
    await assert.rejects(password('unlock','wrong synthetic password'));
    await password('unlock');await signing(1);await cli('sync');
    assert.equal(refreshes,1);
    console.log(`PASS ${mode}: login, sealed persistence, Ed25519/RSA signing, external sync, 401 rotation, refusal, lock/restart/unlock`);
  } finally {
    await stop();
    if(server) await new Promise(r=>server.close(r));
    if(keyName) await run('security',['delete-generic-password','-s','keyward-session','-a',keyName],env).catch(()=>{});
    await fs.rm(home,{recursive:true,force:true});
  }
}
