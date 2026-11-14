import {test} from 'node:test';
import assert from 'node:assert/strict';
import {request} from 'node:http';
import {once} from 'node:events';
import {gzipSync,deflateSync} from 'node:zlib';
import {createTestDatabase} from './postgres-fixture.ts';
import {createApp} from '../server/app.ts';

test('compressed JSON and malformed trailing bytes cannot crash the pre-authentication parser',async()=>{
 const fixture=await createTestDatabase(),server=createApp(fixture.db).listen(0,'127.0.0.1');await once(server,'listening');
 const address=server.address();assert.ok(address&&typeof address!=='string');const base=`http://127.0.0.1:${address.port}`;
 function post(body:Buffer,encoding:string){return new Promise<{status:number;text:string}>((done,reject)=>{
  const req=request(base+'/api/session',{method:'POST',agent:false,headers:{'Content-Type':'application/json','Content-Encoding':encoding,'Content-Length':body.length}},res=>{
   let text='';res.setEncoding('utf8');res.on('data',part=>{text+=part;});res.on('end',()=>done({status:res.statusCode!,text}));res.on('error',reject);
  });req.on('error',reject);req.end(body);
 });}
 try{
  for(const [encoding,compress] of [['gzip',gzipSync],['deflate',deflateSync]] as const){
   const encoded=compress(Buffer.from('{}'));
   assert.equal((await post(encoded,encoding)).status,403,'valid compressed JSON still reaches login CSRF validation');
   const invalid=await post(Buffer.concat([encoded,Buffer.from('fictional trailing bytes')]),encoding);
   // Some decompressors finish before trailing bytes: either safely reject the
   // compressed stream or reach normal challenge validation, never emit a 5xx/crash.
   assert.ok([400,403].includes(invalid.status));
   assert.equal((await fetch(base+'/api/health')).status,200);
  }
  assert.equal((await fetch(base+'/api/session/challenge')).status,200);
  assert.equal(Number((await fixture.db.one('SELECT count(*)::integer AS n FROM users'))!.n),0);
 }finally{await new Promise<void>(done=>server.close(()=>done()));await fixture.close();}
});
