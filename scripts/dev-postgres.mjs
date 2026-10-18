import {spawn} from 'node:child_process';
import {createHash,randomBytes} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync,renameSync,lstatSync,realpathSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=realpathSync(resolve(dirname(fileURLToPath(import.meta.url)),'..'));
const key=createHash('sha256').update(root).digest('hex').slice(0,16);
const ownerLabel='dev.focus.checkout';
const container=`focus-postgres-${key}`,volume=`focus-postgres-${key}`;
const image='postgres:17-bookworm@sha256:3645570cccdfa447589da9f57dd740faa29b30938e861289a5574b6ca6b03826';
export const localPostgresPath=resolve(root,'.data/postgres-local.json');
function present(path){try{lstatSync(path);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
function docker(args,{input,env=process.env,optional=false}={}){
 return new Promise((done,reject)=>{
  const child=spawn('docker',args,{cwd:root,env,stdio:['pipe','pipe','pipe']});let output='';
  child.stdout.on('data',b=>{output+=b;});child.stderr.resume();
  child.once('error',()=>reject(Error('Docker no está disponible. Inicia Docker o reconstruye el devcontainer con Docker-in-Docker.')));
  child.once('exit',code=>code===0?done(output):optional?done(null):reject(Error('PostgreSQL local: una operación Docker ha fallado; se conservan los recursos existentes.')));
  child.stdin.on('error',()=>{});child.stdin.end(input);
 });
}
async function inspect(kind,name){const result=await docker([kind,'inspect',name],{optional:true});return result?JSON.parse(result)[0]:null;}
function owned(resource,labels){if(resource&&labels?.[ownerLabel]!==key)throw Error('El recurso Docker pertenece a otro entorno. No se modifica.');}
function load(){try{return JSON.parse(readFileSync(localPostgresPath,'utf8'));}catch{throw Error('Configuración PostgreSQL local ilegible; se conserva sin imprimir su contenido.');}}
function store(config){
 const tmp=localPostgresPath+`.${process.pid}.tmp`;
 writeFileSync(tmp,JSON.stringify(config,null,2)+'\n',{mode:0o600,flag:'wx'});renameSync(tmp,localPostgresPath);
}
export function readLocalPostgres(){
 if(!present(localPostgresPath))throw Error('PostgreSQL local no preparado. Ejecuta npm run pg:setup.');
 const stat=lstatSync(localPostgresPath);
 if(!stat.isFile()||stat.isSymbolicLink()||(stat.mode&0o077))throw Error('La configuración PostgreSQL debe ser un archivo privado (0600), sin enlaces.');
 const config=load();
 if(config.key!==key||config.container!==container||config.volume!==volume||typeof config.password!=='string'||!config.password||!Number.isInteger(config.port)||config.port<1||config.port>65535)throw Error('La identidad PostgreSQL local no coincide con este checkout. Se conserva sin sustituir.');
 const databaseUrl=`postgresql://focus:${encodeURIComponent(config.password)}@127.0.0.1:${config.port}/focus_demo`;
 const testDatabaseUrl=`postgresql://focus:${encodeURIComponent(config.password)}@127.0.0.1:${config.port}/focus_test`;
 return {...config,databaseUrl,testDatabaseUrl};
}
export async function getLocalPostgres(){
 const dir=dirname(localPostgresPath);mkdirSync(dir,{recursive:true,mode:0o700});
 if(lstatSync(dir).isSymbolicLink())throw Error('La carpeta .data no puede ser un enlace simbólico.');
 let config;
 if(present(localPostgresPath)){
  const stat=lstatSync(localPostgresPath);if(!stat.isFile()||stat.isSymbolicLink()||(stat.mode&0o077))throw Error('Configuración local insegura; requiere modo 0600 y archivo sin enlaces.');
  config=load();
  if(config.key!==key||config.container!==container||config.volume!==volume||!config.password)throw Error('Identidad PostgreSQL local distinta; no se reemplaza.');
 }else{
  // Never invent new credentials for a pre-existing database volume/container.
  if(await inspect('container',container)||await inspect('volume',volume))throw Error('Hay recursos PostgreSQL sin su configuración privada. Recupera el archivo original; no se recrean credenciales.');
  config={key,container,volume,password:randomBytes(32).toString('base64url'),port:null};
  writeFileSync(localPostgresPath,JSON.stringify(config,null,2)+'\n',{mode:0o600,flag:'wx'});
 }
 const vol=await inspect('volume',volume);owned(vol,vol?.Labels);
 let instance=await inspect('container',container);owned(instance,instance?.Config?.Labels);
 if(config.ready&&(!vol||!instance))throw Error('Falta un recurso de PostgreSQL ya inicializado. Recupera su volumen/configuración; no se crea un reemplazo vacío.');
 if(!vol)await docker(['volume','create','--label',`${ownerLabel}=${key}`,volume]);
 if(!instance){
  await docker(['create','--name',container,'--label',`${ownerLabel}=${key}`,'--restart','unless-stopped','--publish','127.0.0.1::5432','--mount',`type=volume,source=${volume},target=/var/lib/postgresql/data`,'--env','POSTGRES_USER=focus','--env','POSTGRES_PASSWORD','--env','POSTGRES_DB=postgres',image],{env:{...process.env,POSTGRES_PASSWORD:config.password}});
  instance=await inspect('container',container);
 }
 const mount=instance.Mounts?.find(mount=>mount.Destination==='/var/lib/postgresql/data');
 const configuredBindings=instance.HostConfig?.PortBindings?.['5432/tcp'];
 if(mount?.Type!=='volume'||mount.Name!==volume||configuredBindings?.length!==1||configuredBindings[0].HostIp!=='127.0.0.1')throw Error('El contenedor local tiene almacenamiento o exposición inesperados. No se inicia ni se cambia.');
 if(!instance.State.Running)await docker(['start',container]);
 let ready=false;
 for(let i=0;i<120;i++){
  if(await docker(['exec',container,'psql','-X','-U','focus','-d','postgres','-tAc','SELECT 1'],{optional:true})){ready=true;break;}
  await new Promise(done=>setTimeout(done,250));
 }
 if(!ready)throw Error('PostgreSQL local no alcanzó readiness. No se crea una base alternativa.');
 for(const name of ['focus_demo','focus_test']){
  const found=await docker(['exec',container,'psql','-X','-U','focus','-d','postgres','-tAc',`SELECT 1 FROM pg_database WHERE datname='${name}'`]);
  if(!found.trim()&&config.ready)throw Error('Falta una base PostgreSQL previamente inicializada. Restaura una copia; no se crea un reemplazo vacío.');
  if(!found.trim())await docker(['exec',container,'psql','-X','-v','ON_ERROR_STOP=1','-U','focus','-d','postgres','-c',`CREATE DATABASE ${name}`]);
 }
 instance=await inspect('container',container);
 const bindings=instance.NetworkSettings.Ports['5432/tcp'];
 if(bindings?.length!==1||bindings[0].HostIp!=='127.0.0.1')throw Error('PostgreSQL debe escuchar exclusivamente en loopback. No se cambia la exposición automáticamente.');
 config.port=Number(bindings[0].HostPort);config.ready=true;store(config);
 const result=readLocalPostgres();
 // Verify authenticated TCP, rather than accepting only a container-local socket.
 const {Client}=await import('pg');const client=new Client({connectionString:result.databaseUrl,connectionTimeoutMillis:5000});
 try{await client.connect();await client.query('SELECT 1');}catch{throw Error('No se puede autenticar contra PostgreSQL local. No se crea una base alternativa.');}finally{await client.end();}
 return result;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const mode=process.argv[2]||'setup';
  if(!['setup','run'].includes(mode))throw Error('Uso: node scripts/dev-postgres.mjs setup | run COMANDO [argumentos]');
  const local=mode==='run'&&process.env.DATABASE_URL?null:await getLocalPostgres();
  if(mode==='setup')console.log('PostgreSQL local preparado: demo y tests separados, puerto solo loopback. Configuración privada en .data/postgres-local.json.');
  else{
   const [command,...args]=process.argv.slice(3);if(!command)throw Error('Falta el comando explícito.');
   const env={...process.env,DATABASE_URL:process.env.DATABASE_URL||local.databaseUrl,DATABASE_SCHEMA:process.env.DATABASE_SCHEMA||'public',FOCUS_DEMO:'false'};
   if(env.FOCUS_DB)throw Error('FOCUS_DB corresponde a SQLite. No lo uses para arrancar PostgreSQL.');
   const child=spawn(command,args,{env,stdio:'inherit'});
   child.once('error',()=>{console.error('No se pudo iniciar el comando PostgreSQL.');process.exitCode=1;});
   child.once('exit',(code,signal)=>{process.exitCode=code??(signal?1:0);});
   for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>child.kill(signal));
  }
 }catch(error){console.error(error.message);process.exitCode=1;}
}
