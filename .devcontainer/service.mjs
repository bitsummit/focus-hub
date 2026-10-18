import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {existsSync,readFileSync,writeFileSync,openSync,closeSync,unlinkSync,mkdirSync,realpathSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=realpathSync(resolve(dirname(fileURLToPath(import.meta.url)),'..'));
process.chdir(root);
const pidPath=resolve('.data/codespaces-server.pid'), logPath=resolve('.data/codespaces-server.log');
const serverPath=resolve('server/index.ts');
function databaseTarget(){
 if(!process.env.DATABASE_URL)throw Error('DATABASE_URL ausente; no se abre una base de reemplazo.');
 let url;try{url=new URL(process.env.DATABASE_URL);}catch{throw Error('DATABASE_URL inválida.');}
 const schema=process.env.DATABASE_SCHEMA||'public';
 return 'pg:'+createHash('sha256').update(JSON.stringify([url.hostname,url.port||'5432',decodeURIComponent(url.pathname.slice(1)),decodeURIComponent(url.username),schema])).digest('hex');
}
async function verifyTarget(){
 const {openDatabase}=await import('../server/db.ts');const db=await openDatabase();
 try{
  if(process.env.FOCUS_DEMO==='true'){
   if(!existsSync('.data/demo-access.json'))throw Error('Falta el acceso de la demo. Ejecuta setup, sin regenerar datos existentes.');
   const access=JSON.parse(readFileSync('.data/demo-access.json','utf8'));
   if(access.database!==db.identity||!await db.one('SELECT id FROM users LIMIT 1'))throw Error('Metadatos y destino de demo no coinciden; no se sustituye nada.');
  }
 }finally{await db.close();}
}
const pause=ms=>new Promise(r=>setTimeout(r,ms));
function alive(pid){
 try{process.kill(pid,0);return !/\) Z /.test(readFileSync(`/proc/${pid}/stat`,'utf8'));}catch(e){if(e.code==='ESRCH'||e.code==='ENOENT')return false;throw e;}
}
function ownerPid(){
 if(!existsSync(pidPath))return null;
 const stored=JSON.parse(readFileSync(pidPath,'utf8'));
 const pid=typeof stored==='number'?stored:stored.pid;if(!Number.isSafeInteger(pid)||pid<1)throw Error('PID de servicio no válido; no se modifica ningún proceso.');
 if(!alive(pid)){unlinkSync(pidPath);return null;}
 // Only manage the exact server launched by this checkout. Never kill a process merely occupying a port.
 const args=readFileSync(`/proc/${pid}/cmdline`,'utf8').split('\0');
 if(!args.includes(serverPath))throw Error('El PID pertenece a otro proceso; no se detiene ni sustituye.');
 return pid;
}
async function smoke(){
 if(process.env.FOCUS_DEMO!=='true')return;
 await new Promise((done,reject)=>{const child=spawn(process.execPath,['--import','tsx',resolve('scripts/smoke-demo.ts')],{cwd:root,env:process.env,stdio:'inherit'});child.on('error',reject);child.on('exit',code=>code===0?done():reject(Error('La comprobación funcional de la demo ha fallado.')));});
}
async function stop(){
 const pid=ownerPid();if(!pid){console.log('No hay un servicio gestionado activo.');return;}
 process.kill(pid,'SIGTERM');
 for(let i=0;i<60&&alive(pid);i++)await pause(100);
 if(alive(pid))throw Error('El servicio no se ha detenido. Se conserva el PID para revisarlo; no se mata otro proceso.');
 if(existsSync(pidPath))unlinkSync(pidPath);
 console.log('Servicio de este checkout detenido; los datos se conservan.');
}
try{
 if(process.argv[2]==='stop'){await stop();}
 else if(process.argv[2]==='start'){
  if(process.env.FOCUS_DEV!=='true'&&!existsSync('dist/index.html'))throw Error('Primero ejecuta npm run build.');
  const target=databaseTarget();await verifyTarget();
  mkdirSync('.data',{recursive:true,mode:0o700});
  const port=Number(process.env.PORT||3000);if(!Number.isInteger(port)||port<1||port>65535)throw Error('PORT inválido.');
  const pid=ownerPid();
  if(pid){
   const saved=JSON.parse(readFileSync(pidPath,'utf8'));
   if(saved.port!==port||saved.origin!==(process.env.FOCUS_PUBLIC_ORIGIN||null)||saved.secure!==(process.env.COOKIE_SECURE==='true')||Boolean(saved.development)!==(process.env.FOCUS_DEV==='true')||saved.database!==target||Boolean(saved.demo)!==(process.env.FOCUS_DEMO==='true'))throw Error('El servicio gestionado usa otra configuración. Deténlo antes de cambiar puerto, origen o modo de desarrollo.');
   await smoke();console.log(`Focus Hub ya está activo en el puerto ${port}.`);
  }
  else{
   // Refuse to reuse an unrelated process or disclose credentials to a server already on this port.
   const {createConnection}=await import('node:net');
   const occupied=await new Promise(done=>{const socket=createConnection({host:'127.0.0.1',port});socket.once('connect',()=>{socket.destroy();done(true);});socket.once('error',()=>{socket.destroy();done(false);});});
   if(occupied)throw Error(`El puerto ${port} está ocupado. No se toca el proceso existente.`);
   const log=openSync(logPath,'a',0o600);
   const child=spawn(process.execPath,['--import','tsx',serverPath],{cwd:root,env:process.env,stdio:['ignore',log,log],detached:true});closeSync(log);
   let spawnError;child.once('error',e=>{spawnError=e;});child.unref();
   if(child.pid)writeFileSync(pidPath,JSON.stringify({pid:child.pid,port,origin:process.env.FOCUS_PUBLIC_ORIGIN||null,secure:process.env.COOKIE_SECURE==='true',development:process.env.FOCUS_DEV==='true',database:target,demo:process.env.FOCUS_DEMO==='true'}),{mode:0o600});
   let healthy=false;
   for(let i=0;i<120;i++){if(spawnError)throw spawnError;try{const r=await fetch(`http://127.0.0.1:${port}/api/health`,{signal:AbortSignal.timeout(1000)});if(r.ok){healthy=true;break;}}catch{}await pause(250);}
   if(!healthy){await stop();throw Error('No se alcanzó readiness. Revisa .data/codespaces-server.log.');}
   try{await smoke();}catch(e){await stop();throw e;}
   console.log(`Focus Hub preparado en el puerto ${port}. En Codespaces, confirma Ports → 3000 → Private y abre el navegador.`);
  }
 }else throw Error('Uso: node .devcontainer/service.mjs start|stop');
}catch(e){const safe=e.message?.includes('password')||/postgres(?:ql)?:\/\//.test(e.message||'')||e.code;console.error(safe?'No se pudo gestionar el servicio: revisa PostgreSQL/migraciones y su configuración privada.':e.message);process.exitCode=1;}
