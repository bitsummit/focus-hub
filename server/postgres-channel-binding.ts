import {Client,Connection,type ClientConfig} from 'pg';
import type {TLSSocket} from 'node:tls';

const bindingError=()=>Object.assign(new Error('PostgreSQL requiere TLS verificado y SCRAM-SHA-256-PLUS, sin degradación.'),{code:'CHANNEL_BINDING_REQUIRED'});

/** Narrow transport guard for pinned pg 8.23.1; SCRAM/proof validation stays in pg. */
export class ChannelBindingConnection extends Connection {
 private phase:'initial'|'continue'|'final'|'verified'='initial';
 private authenticated=false;
 private failed=false;
 private verifiedTLS(){const socket=this.stream as TLSSocket;return socket.encrypted===true&&socket.authorized===true;}
 private rejectBinding(){
  if(this.failed)return false;
  this.failed=true;this.stream.destroy();
  return super.emit('error',bindingError());
 }
 override emit(event:string|symbol,...args:any[]):boolean{
  if(this.failed&&event!=='error'&&event!=='end')return false;
  if(event==='error'||(event==='errorMessage'&&this.phase!=='verified')){
   this.failed=true;this.stream.destroy();return super.emit(event,...args);
  }
  if(event==='authenticationCleartextPassword'||event==='authenticationMD5Password')return this.rejectBinding();
  if(event==='authenticationSASL'){
   if(this.phase!=='initial'||!this.verifiedTLS()||(!Array.isArray(args[0]?.mechanisms)||!args[0].mechanisms.includes('SCRAM-SHA-256-PLUS')))return this.rejectBinding();
   this.phase='continue';
  }
  if(event==='authenticationSASLContinue'){
   if(this.phase!=='continue'||!this.verifiedTLS())return this.rejectBinding();
   this.phase='final';
  }
  if(event==='authenticationSASLFinal'){
   if(this.phase!=='final'||!this.verifiedTLS())return this.rejectBinding();
   // pg verifies the server proof synchronously here. A failure emits 'error',
   // setting failed before any buffered ReadyForQuery can reach the client.
   const emitted=super.emit(event,...args);
   if(!emitted&&!this.failed)return this.rejectBinding();
   if(!this.failed)this.phase='verified';
   return emitted;
  }
  if(event==='authenticationOk'){
   if(this.phase!=='verified'||this.authenticated||!this.verifiedTLS())return this.rejectBinding();
   this.authenticated=true;
  }
  if(event==='readyForQuery'&&(!this.authenticated||this.phase!=='verified'||!this.verifiedTLS()))return this.rejectBinding();
  return super.emit(event,...args);
 }
}

export class RequiredChannelBindingClient extends Client {
 constructor(config:ClientConfig={}){
  if(!config.ssl)throw bindingError();
  const tls=typeof config.ssl==='object'?config.ssl:{};
  if(tls.rejectUnauthorized===false||tls.checkServerIdentity!==undefined)throw bindingError();
  // Database normalizes security URL parameters before selecting this client.
  // Refuse an unnormalized URL so pg cannot override the verified TLS settings.
  if(config.connectionString){
   const url=new URL(config.connectionString);
   if([...url.searchParams.keys()].some(key=>key!=='application_name'))throw bindingError();
  }
  const ssl={...tls,rejectUnauthorized:true};
  const guarded:ClientConfig&{connection:Connection;enableChannelBinding:boolean}={...config,ssl,enableChannelBinding:true,connection:new ChannelBindingConnection({...config,ssl})};
  super(guarded);
 }
}
