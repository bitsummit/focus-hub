import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {once} from 'node:events';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {createServer,type Socket} from 'node:net';
import {TLSSocket,createSecureContext} from 'node:tls';
import {RequiredChannelBindingClient} from '../server/postgres-channel-binding.ts';
import {Database} from '../server/db.ts';

const image='postgres:17-bookworm@sha256:3645570cccdfa447589da9f57dd740faa29b30938e861289a5574b6ca6b03826';
const container='focus-binding-test-'+randomUUID().replaceAll('-','');
const directory=mkdtempSync(join(tmpdir(),'focus-channel-binding-'));
const key=join(directory,'key.pem'),certificate=join(directory,'cert.pem');
const password=randomBytes(30).toString('base64url');
let created=false,port=0;
function docker(args:string[],env:NodeJS.ProcessEnv=process.env){return execFileSync('docker',args,{env,encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:30000});}
before(async()=>{
 execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',certificate,'-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost,IP:127.0.0.1'],{stdio:'ignore'});
 docker(['create','--name',container,'--publish','127.0.0.1::5432','--env','POSTGRES_USER=focus_binding_fixture','--env','POSTGRES_DB=focus_binding_fixture','--env','POSTGRES_PASSWORD','--env','POSTGRES_HOST_AUTH_METHOD=scram-sha-256','--entrypoint','sh',image,'-c','chown postgres:postgres /tmp/focus-test-key.pem /tmp/focus-test-cert.pem && chmod 600 /tmp/focus-test-key.pem && exec docker-entrypoint.sh postgres -c ssl=on -c ssl_cert_file=/tmp/focus-test-cert.pem -c ssl_key_file=/tmp/focus-test-key.pem'],{...process.env,POSTGRES_PASSWORD:password});created=true;
 docker(['cp',key,container+':/tmp/focus-test-key.pem']);docker(['cp',certificate,container+':/tmp/focus-test-cert.pem']);docker(['start',container]);
 let ready=false;
 for(let i=0;i<100&&!ready;i++){
  const check=spawnSync('docker',['exec',container,'pg_isready','-h','127.0.0.1','-U','focus_binding_fixture','-d','focus_binding_fixture'],{stdio:'ignore',timeout:5000});
  ready=check.status===0;if(!ready)await new Promise(done=>setTimeout(done,100));
 }
 assert.ok(ready,'own isolated PostgreSQL TLS fixture must become ready');
 const binding=JSON.parse(docker(['inspect','--format','{{json .NetworkSettings.Ports}}',container]))['5432/tcp'];
 assert.equal(binding[0].HostIp,'127.0.0.1');port=Number(binding[0].HostPort);
});
after(()=>{try{if(created)docker(['rm','--force',container]);}finally{rmSync(directory,{recursive:true,force:true});}});
function options(){return {host:'127.0.0.1',port,user:'focus_binding_fixture',password,database:'focus_binding_fixture',connectionTimeoutMillis:3000,ssl:{ca:readFileSync(certificate),rejectUnauthorized:true}};}

test('required channel binding authenticates against real PostgreSQL TLS using SCRAM-SHA-256-PLUS',async()=>{
 const client=new RequiredChannelBindingClient(options());
 const connection=client.connection as typeof client.connection&{sendSASLInitialResponseMessage:(mechanism:string,response:string)=>void};
 const mechanisms:string[]=[],send=connection.sendSASLInitialResponseMessage.bind(connection);
 connection.sendSASLInitialResponseMessage=(mechanism,response)=>{mechanisms.push(mechanism);send(mechanism,response);};
 try{
  await client.connect();
  assert.deepEqual(mechanisms,['SCRAM-SHA-256-PLUS']);
  const result=await client.query('SELECT current_database() AS database, ssl FROM pg_catalog.pg_stat_ssl WHERE pid=pg_catalog.pg_backend_pid()');
  assert.equal(result.rows[0].database,'focus_binding_fixture');assert.equal(result.rows[0].ssl,true);
 }finally{await client.end();}
});

test('required channel binding never bypasses certificate validation',async()=>{
 const client=new RequiredChannelBindingClient({...options(),ssl:{rejectUnauthorized:true}});
 try{await assert.rejects(client.connect(),(error:unknown)=>['DEPTH_ZERO_SELF_SIGNED_CERT','SELF_SIGNED_CERT_IN_CHAIN','UNABLE_TO_VERIFY_LEAF_SIGNATURE'].includes(String((error as NodeJS.ErrnoException).code)));}
 finally{await client.end();}
});

test('Database accepts a Neon-shaped require URL using a trusted test CA and keeps TLS and PLUS enabled',()=>{
 const connection=`postgresql://focus_binding_fixture:${encodeURIComponent(password)}@127.0.0.1:${port}/focus_binding_fixture?sslmode=verify-full&channel_binding=require`;
 const env:NodeJS.ProcessEnv={...process.env,DATABASE_URL:connection,NODE_EXTRA_CA_CERTS:certificate};delete env.FOCUS_DB;delete env.DATABASE_SCHEMA;delete env.FOCUS_DEMO;
 const code=`import {Database} from ${JSON.stringify(new URL('../server/db.ts',import.meta.url).href)};const db=new Database(undefined,{schema:'public',max:1});try{const r=await db.one('SELECT ssl FROM pg_catalog.pg_stat_ssl WHERE pid=pg_catalog.pg_backend_pid()');if(r?.ssl!==true)process.exitCode=1;console.log(JSON.stringify({tls:r?.ssl===true}));}catch{console.error('Fixture connection failed');process.exitCode=1;}finally{await db.close();}`;
 const child=spawnSync(process.execPath,['--import',new URL('../node_modules/tsx/dist/loader.mjs',import.meta.url).pathname,'--input-type=module','-e',code],{env,encoding:'utf8',timeout:15000});
 assert.equal(child.status,0,'real application Database must support required binding over verified TLS');assert.deepEqual(JSON.parse(child.stdout),{tls:true});assert.ok(!child.stderr.includes(password));
});

function frame(type:string,payload:Buffer){const header=Buffer.alloc(5);header[0]=type.charCodeAt(0);header.writeInt32BE(payload.length+4,1);return Buffer.concat([header,payload]);}
function auth(code:number,extra=Buffer.alloc(0)){const payload=Buffer.alloc(4);payload.writeInt32BE(code);return frame('R',Buffer.concat([payload,extra]));}
const ready=()=>frame('Z',Buffer.from('I'));
type FailureMode='base-scram'|'cleartext'|'md5'|'trust'|'invalid-final'|'premature-ready';
async function fakeServer(mode:FailureMode){
 const sockets=new Set<Socket>(),packets:string[]=[];let proofPackets=0;
 const context=createSecureContext({key:readFileSync(key),cert:readFileSync(certificate)});
 const server=createServer(raw=>{
  sockets.add(raw);raw.on('error',()=>{});raw.on('close',()=>sockets.delete(raw));
  raw.once('data',request=>{
   if(request.length!==8||request.readInt32BE(4)!==80877103){raw.destroy();return;}
   raw.write('S');const tls=new TLSSocket(raw,{isServer:true,secureContext:context});sockets.add(tls);tls.on('error',()=>{});tls.on('close',()=>sockets.delete(tls));
   let startup=true,buffer=Buffer.alloc(0),nonce='';
   tls.on('data',part=>{
    buffer=Buffer.concat([buffer,part]);
    if(startup){
     if(buffer.length<4||buffer.length<buffer.readInt32BE(0))return;
     buffer=buffer.subarray(buffer.readInt32BE(0));startup=false;
     if(mode==='base-scram')tls.write(Buffer.concat([auth(10,Buffer.from('SCRAM-SHA-256\0\0')),ready()]));
     if(mode==='cleartext')tls.write(auth(3));
     if(mode==='md5')tls.write(auth(5,Buffer.from([1,2,3,4])));
     if(mode==='trust')tls.write(Buffer.concat([auth(0),ready()]));
     if(mode==='invalid-final'||mode==='premature-ready')tls.write(auth(10,Buffer.from('SCRAM-SHA-256-PLUS\0SCRAM-SHA-256\0\0')));
    }
    while(buffer.length>=5&&buffer.length>=buffer.readInt32BE(1)+1){
     const size=buffer.readInt32BE(1)+1,type=String.fromCharCode(buffer[0]),body=buffer.subarray(5,size);buffer=buffer.subarray(size);packets.push(type);
     if(type==='p'&&!nonce&&(mode==='invalid-final'||mode==='premature-ready')){
      const separator=body.indexOf(0),mechanism=body.subarray(0,separator).toString();assert.equal(mechanism,'SCRAM-SHA-256-PLUS');
      const initial=body.subarray(separator+5).toString();nonce=initial.match(/,r=([^,]+)/)![1];
      if(mode==='premature-ready')tls.write(ready());
      else tls.write(auth(11,Buffer.from(`r=${nonce}fixture-server,s=${Buffer.from('fictional-test-salt').toString('base64')},i=4096`)));
     }else if(type==='p'&&mode==='invalid-final'){
      proofPackets++;tls.write(Buffer.concat([auth(12,Buffer.from('v='+Buffer.alloc(32).toString('base64'))),ready()]));
     }
    }
   });
  });
 });
 server.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();assert.ok(address&&typeof address!=='string');
 return {port:address.port,packets,proofPackets:()=>proofPackets,async close(){for(const socket of sockets)socket.destroy();await new Promise<void>(done=>server.close(()=>done()));}};
}
for(const mode of ['base-scram','cleartext','md5','trust','invalid-final','premature-ready'] as const)test(`required binding rejects ${mode} authentication without releasing a usable client`,async()=>{
 const server=await fakeServer(mode),client=new RequiredChannelBindingClient({...options(),port:server.port});
 client.on('error',()=>{});
 try{
  await assert.rejects(client.connect());await new Promise(done=>setTimeout(done,20));
  assert.ok(!server.packets.includes('Q'),'no application query may be sent');
  if(['base-scram','cleartext','md5','trust'].includes(mode))assert.ok(!server.packets.includes('p'),'no password or SCRAM response may be sent for a downgraded mechanism');
  if(mode==='invalid-final')assert.equal(server.proofPackets(),1,'invalid final case must actually exercise native SCRAM verification');
 }finally{await client.end();await server.close();}
});

test('required binding refuses plaintext and malformed or duplicate URL policy before connection',()=>{
 for(const suffix of ['sslmode=verify-full&channel_binding=','sslmode=disable&channel_binding=require','sslmode=verify-full&channel_binding=unknown','sslmode=verify-full&channel_binding=disable&channel_binding=require','sslmode=disable&sslmode=verify-full'])assert.throws(()=>new Database(`postgresql://fictional:unused@127.0.0.1:1/fixture?${suffix}`));
});
