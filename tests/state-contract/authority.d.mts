export const credentials: {server:string;email:string;password:string};
export const clock: number;
export const sshKeys: {privateKey:string;publicKey:string;fingerprint:string;algorithm:string}[];
export class Authority {
  state: {profile:Record<string,unknown>;folders:{id:string;name:string}[];collections:unknown[];ciphers:Record<string,any>[]};
  calls: {url:string;method:string;body:string}[];
  rejectWrites: boolean;
  ackWithoutCommit: boolean;
  read(id:string): Record<string,any>;
  external(id:string,change:(plain:Record<string,any>)=>void):void;
  request(req:{url:string;method?:string;body?:string}):{status:number;body:any};
  fetch(url:string,init:RequestInit):Promise<Response>;
  open(value:string):string;
}
