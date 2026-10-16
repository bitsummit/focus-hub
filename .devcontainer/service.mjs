import {spawn} from 'node:child_process';
import {existsSync,readFileSync,writeFileSync,openSync,closeSync,unlinkSync,mkdirSync,realpathSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=realpathSync(resolve(dirname(fileURLToPath(import.meta.url)),'..'));
process.chdir(root);
const pidPath=resolve('.data/codespaces-server.pid'), logPath=resolve('.data/codespaces-server.log');
const serverPath=resolve('server/index.ts');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
function alive(pid){
 try{process.kill(pid,0);return !/\) Z /.test(readFileSync(`/proc/${pid}/stat`,'utf8'));}catch(e){if(e.code==='ESRCH'||e.code==='ENOENT')return false;throw e;}
}
function ownerPid(){
 if(!existsSync(pidPath))return null;
 const pid=Number(readFileSync(pidPath,'utf8').trim());if(!Number.isSafeInteger(pid)||pid<1)throw Error('PID de servicio no válido; no se modifica ningún proceso.');
 if(!alive(pid)){unlinkSync(pidPath);return null;}
 // Only manage the exact server launched by this checkout. Never kill a process merely occupying a port.
 const args=readFileSync(`/proc/${pid}/cmdline`,'utf8').split('\0');
 if(!args.includes(serverPath))throw Error('El PID pertenece a otro proceso; no se detiene ni sustituye.');
 return pid;
}
async function smoke(){
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
  if(!existsSync('dist/index.html')||!existsSync('.data/demo.sqlite')||!existsSync('.data/demo-access.json'))throw Error('Primero ejecuta bash .devcontainer/setup.sh; no se crea ni sobrescribe una demo durante el arranque.');
  mkdirSync('.data',{recursive:true,mode:0o700});
  const port=Number(process.env.PORT||3000);if(!Number.isInteger(port)||port<1||port>65535)throw Error('PORT inválido.');
  const pid=ownerPid();
  if(pid){await smoke();console.log(`Focus Hub ya está activo en el puerto ${port}.`);}
  else{
   // Refuse to reuse an unrelated process or disclose credentials to a server already on this port.
   const {createConnection}=await import('node:net');
   const occupied=await new Promise(done=>{const socket=createConnection({host:'127.0.0.1',port});socket.once('connect',()=>{socket.destroy();done(true);});socket.once('error',()=>{socket.destroy();done(false);});});
   if(occupied)throw Error(`El puerto ${port} está ocupado. No se toca el proceso existente.`);
   const log=openSync(logPath,'a',0o600);
   const child=spawn(process.execPath,['--import','tsx',serverPath],{cwd:root,env:process.env,stdio:['ignore',log,log],detached:true});closeSync(log);
   let spawnError;child.once('error',e=>{spawnError=e;});child.unref();
   if(child.pid)writeFileSync(pidPath,String(child.pid),{mode:0o600});
   let healthy=false;
   for(let i=0;i<120;i++){if(spawnError)throw spawnError;try{const r=await fetch(`http://127.0.0.1:${port}/api/health`,{signal:AbortSignal.timeout(1000)});if(r.ok){healthy=true;break;}}catch{}await pause(250);}
   if(!healthy){await stop();throw Error('No se alcanzó readiness. Revisa .data/codespaces-server.log.');}
   try{await smoke();}catch(e){await stop();throw e;}
   console.log(`Focus Hub preparado en el puerto ${port}. En Codespaces, confirma Ports → 3000 → Private y abre el navegador.`);
  }
 }else throw Error('Uso: node .devcontainer/service.mjs start|stop');
}catch(e){console.error(e.message);process.exitCode=1;}
