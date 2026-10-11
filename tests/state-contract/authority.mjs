// A stateful test authority. Encryption and independent reads use node:crypto,
// never WebBackend's snapshot, cache, selectors or encryption implementation.
import * as crypto from 'node:crypto';

export const credentials = { server: 'https://contract.example', email: 'contract@example.test', password: 'contract test password' };
export const clock = 1_791_000_000_000;
const clone = value => structuredClone(value);
const bytes = (name, value) => {
  const b = Buffer.from(value); const n = Buffer.alloc(4); n.writeUInt32BE(b.length);
  return Buffer.concat([n, b]);
};
function keyPair(algorithm) {
  const pair = crypto.generateKeyPairSync(algorithm === 'Ed25519' ? 'ed25519' : 'rsa', algorithm === 'RSA' ? {modulusLength:2048} : {});
  const jwk = pair.publicKey.export({format:'jwk'});
  const integer = b => b[0] & 128 ? Buffer.concat([Buffer.from([0]),b]) : b;
  const body = algorithm === 'Ed25519'
    ? Buffer.concat([bytes('', 'ssh-ed25519'), bytes('', Buffer.from(jwk.x, 'base64url'))])
    : Buffer.concat([bytes('', 'ssh-rsa'), bytes('', integer(Buffer.from(jwk.e, 'base64url'))), bytes('', integer(Buffer.from(jwk.n, 'base64url')))]);
  return {
    privateKey: pair.privateKey.export({type:'pkcs8',format:'pem'}).toString(),
    publicKey: `${algorithm === 'Ed25519' ? 'ssh-ed25519' : 'ssh-rsa'} ${body.toString('base64')}`,
    fingerprint: 'SHA256:' + crypto.createHash('sha256').update(body).digest('base64').replace(/=+$/, ''),
    algorithm,
  };
}
// Generated once, but every authority has independent ciphertexts and state.
export const sshKeys = [keyPair('Ed25519'), keyPair('RSA')];

export class Authority {
  constructor() {
    this.userKey = crypto.randomBytes(64);
    const master = crypto.pbkdf2Sync(credentials.password, credentials.email, 100000, 32, 'sha256');
    this.passwordHash = crypto.pbkdf2Sync(master, credentials.password, 1, 32, 'sha256').toString('base64');
    const stretched = Buffer.concat(['enc','mac'].map(name => crypto.createHmac('sha256', master).update(Buffer.concat([Buffer.from(name),Buffer.from([1])])).digest()));
    this.access = `${Buffer.from('{"alg":"RS256"}').toString('base64url')}.${Buffer.from(JSON.stringify({exp: Math.floor(clock/1000)+3600})).toString('base64url')}.sig`;
    this.state = {
      profile: {id:'contract-user',email:credentials.email,name:'Contract user',key:this.seal(this.userKey,stretched),privateKey:null,organizations:[]},
      folders: [{id:'folder',name:this.seal('Contract folder')},{id:'other',name:this.seal('Other folder')}],
      collections: [],
      ciphers: [
        this.encode({id:'login',type:1,name:'Contract login',folderId:'folder',favorite:false,reprompt:0,notes:'Original note',login:{username:'original-user',password:'Original password 123!',totp:null,uris:[{uri:'https://old.example.test',match:null}]},fields:[]}),
        this.encode({id:'peer',type:1,name:'Peer login',folderId:'folder',favorite:false,reprompt:0,login:{username:'peer',password:'Different password 123!',uris:[]},fields:[]}),
        this.encode({id:'card',type:3,name:'Contract card',folderId:'folder',favorite:false,reprompt:0,card:{cardholderName:'Original holder',brand:'Visa',number:'4111111111111111',expMonth:'1',expYear:'2030',code:'123'},fields:[]}),
        this.encode({id:'identity',type:4,name:'Contract identity',folderId:'folder',favorite:false,reprompt:0,identity:{firstName:'Original',lastName:'Person',email:'old@example.test',phone:'1234',company:'Original company'},fields:[]}),
        this.encode({id:'note',type:2,name:'Contract note',folderId:'folder',favorite:false,reprompt:0,notes:'Original note',secureNote:{type:0},fields:[]}),
        this.encode({id:'ssh',type:5,name:'Contract key',folderId:'folder',favorite:false,reprompt:0,sshKey:{privateKey:sshKeys[0].privateKey,publicKey:sshKeys[0].publicKey,keyFingerprint:sshKeys[0].fingerprint},fields:[]}),
      ],
    };
    this.calls=[];
    this.rejectWrites=false;
    this.ackWithoutCommit=false;
    this.next=0;
  }
  seal(value, key=this.userKey) {
    const iv=crypto.randomBytes(16), c=crypto.createCipheriv('aes-256-cbc',key.subarray(0,32),iv);
    const ct=Buffer.concat([c.update(value),c.final()]);
    const mac=crypto.createHmac('sha256',key.subarray(32)).update(Buffer.concat([iv,ct])).digest();
    return `2.${iv.toString('base64')}|${ct.toString('base64')}|${mac.toString('base64')}`;
  }
  open(value) {
    if (typeof value !== 'string' || !value.startsWith('2.')) return value;
    const [iv,ct,mac]=value.slice(2).split('|').map(s=>Buffer.from(s,'base64'));
    const expected=crypto.createHmac('sha256',this.userKey.subarray(32)).update(Buffer.concat([iv,ct])).digest();
    if (!crypto.timingSafeEqual(expected,mac)) throw Error('authority: invalid MAC');
    const d=crypto.createDecipheriv('aes-256-cbc',this.userKey.subarray(0,32),iv);
    return Buffer.concat([d.update(ct),d.final()]).toString();
  }
  decode(value) {
    if (Array.isArray(value)) return value.map(x=>this.decode(x));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,this.decode(v)]));
    return this.open(value);
  }
  encode(value, field='') {
    if (Array.isArray(value)) return value.map(x=>this.encode(x,field));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,this.encode(v,k)]));
    const plaintext = new Set(['id','folderId','organizationId','revisionDate','deletedDate','passwordRevisionDate']);
    return typeof value === 'string' && !plaintext.has(field) ? this.seal(value) : value;
  }
  read(id) {
    const c=this.state.ciphers.find(c=>c.id===id); if(!c) throw Error('authority: missing cipher '+id);
    return this.decode(clone(c));
  }
  external(id, change) {
    const plain=this.read(id);change(plain);
    this.state.ciphers[this.state.ciphers.findIndex(c=>c.id===id)]=this.encode(plain);
  }
  request({url,method='GET',body=''}) {
    this.calls.push({url,method,body});
    const path=new URL(url).pathname;
    if(path.endsWith('/accounts/prelogin'))return {status:200,body:{kdf:0,kdfIterations:100000}};
    if(path.endsWith('/connect/token'))return new URLSearchParams(body).get('password')===this.passwordHash
      ? {status:200,body:{access_token:this.access,refresh_token:'contract-refresh',Key:this.state.profile.key}}
      : {status:400,body:{error_description:'invalid_username_or_password'}};
    if(path==='/api/sync')return {status:200,body:clone(this.state)};
    if(!path.startsWith('/api/'))return {status:404,body:{}};
    if(method!=='GET' && this.rejectWrites)return {status:500,body:{message:'contract write refused'}};
    const id=path.split('/')[3];
    const cipher=this.state.ciphers.find(c=>c.id===id);
    if(method==='GET' && cipher)return {status:200,body:clone(cipher)};
    if(method==='PUT' && /^\/api\/ciphers\/[^/]+$/.test(path) && cipher){
      if(!this.ackWithoutCommit)this.state.ciphers[this.state.ciphers.indexOf(cipher)]={...JSON.parse(body),id};
      return {status:200,body:clone(cipher)};
    }
    if(method==='POST' && path==='/api/ciphers'){
      const c={...JSON.parse(body),id:'created-'+(++this.next)};
      if(!this.ackWithoutCommit)this.state.ciphers.push(c);
      return {status:200,body:{id:c.id}};
    }
    if(method==='PUT' && path.startsWith('/api/folders/')){
      const f=this.state.folders.find(f=>f.id===id);
      if(f && !this.ackWithoutCommit)Object.assign(f,JSON.parse(body));
      return {status:200,body:{id}};
    }
    if(method==='PUT' && ['/api/ciphers/delete','/api/ciphers/restore'].includes(path)){
      const ids=JSON.parse(body).ids;
      if(!this.ackWithoutCommit)for(const c of this.state.ciphers)if(ids.includes(c.id))c.deletedDate=path.endsWith('/delete')?'2026-10-10T00:00:00Z':null;
      return {status:200,body:{}};
    }
    return {status:404,body:{message:'authority has no route '+method+' '+path}};
  }
  fetch = async (url, init) => {
    const r=this.request({url,method:init?.method,body:typeof init?.body==='string'?init.body:''});
    return new Response(JSON.stringify(r.body),{status:r.status});
  };
}
