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
function validateAccounts(config){
 if(config.accounts===undefined){
  if(config.accountsReady)throw Error('Falta la configuración de cuentas PostgreSQL inicializadas. Recupera el archivo original; no se regeneran credenciales.');
  return;
 }
 const accounts=config.accounts;
 if(!accounts||typeof accounts!=='object'||Array.isArray(accounts)||Object.keys(accounts).sort().join(',')!=='demo,dev,test')throw Error('Configuración de cuentas locales incompatible; no se reemplaza.');
 for(const kind of ['dev','demo','test']){
  const account=accounts[kind];
  if(!account||account.role!==`focus_${kind}_runtime`||typeof account.password!=='string'||!account.password)throw Error('Configuración de cuentas locales incompatible; no se reemplaza.');
 }
 const passwords=Object.values(accounts).map(account=>account.password);
 if(new Set(passwords).size!==3||passwords.includes(config.password))throw Error('Las cuentas PostgreSQL requieren credenciales independientes; no se regeneran automáticamente.');
}
export function readLocalPostgres(){
 if(!present(localPostgresPath))throw Error('PostgreSQL local no preparado. Ejecuta npm run pg:setup.');
 const stat=lstatSync(localPostgresPath);
 if(!stat.isFile()||stat.isSymbolicLink()||(stat.mode&0o077))throw Error('La configuración PostgreSQL debe ser un archivo privado (0600), sin enlaces.');
 const config=load();
 validateAccounts(config);
 if(config.key!==key||config.container!==container||config.volume!==volume||typeof config.password!=='string'||!config.password||!Number.isInteger(config.port)||config.port<1||config.port>65535)throw Error('La identidad PostgreSQL local no coincide con este checkout. Se conserva sin sustituir.');
 const url=(user,password,database)=>`postgresql://${user}:${encodeURIComponent(password)}@127.0.0.1:${config.port}/${database}`;
 const legacy=url('focus',config.password,'focus_demo');
 const accounts=config.accounts;
 const demoDatabaseUrl=accounts?url(accounts.demo.role,accounts.demo.password,'focus_demo'):legacy;
 const developmentUrl=accounts?url(accounts.dev.role,accounts.dev.password,'focus_dev'):undefined;
 const testDatabaseUrl=accounts?url(accounts.test.role,accounts.test.password,'focus_test'):url('focus',config.password,'focus_test');
 const databaseUrl=config.legacyDemo?legacy:demoDatabaseUrl;
 return {...config,databaseUrl,demoDatabaseUrl,developmentUrl,testDatabaseUrl};
}
export async function getLocalPostgres(){
 if(process.env.NODE_ENV==='production')throw Error('Producción requiere DATABASE_URL explícita y no utiliza PostgreSQL local automáticamente.');
 const dir=dirname(localPostgresPath);mkdirSync(dir,{recursive:true,mode:0o700});
 if(lstatSync(dir).isSymbolicLink())throw Error('La carpeta .data no puede ser un enlace simbólico.');
 let config;
 if(present(localPostgresPath)){
  const stat=lstatSync(localPostgresPath);if(!stat.isFile()||stat.isSymbolicLink()||(stat.mode&0o077))throw Error('Configuración local insegura; requiere modo 0600 y archivo sin enlaces.');
  config=load();
  if(config.key!==key||config.container!==container||config.volume!==volume||!config.password)throw Error('Identidad PostgreSQL local distinta; no se reemplaza.');
  validateAccounts(config);
 }else{
  // Never invent new credentials for a pre-existing database volume/container.
  if(await inspect('container',container)||await inspect('volume',volume))throw Error('Hay recursos PostgreSQL sin su configuración privada. Recupera el archivo original; no se recrean credenciales.');
  config={key,container,volume,password:randomBytes(32).toString('base64url'),port:null,legacyDemo:false};
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
 readLocalPostgres();
 // Verify authenticated TCP, rather than accepting only a container-local socket.
 const {Client}=await import('pg');const client=new Client({connectionString:`postgresql://focus:${encodeURIComponent(config.password)}@127.0.0.1:${config.port}/postgres`,connectionTimeoutMillis:5000});
 try{await client.connect();await client.query('SELECT 1');}catch{throw Error('No se puede autenticar contra PostgreSQL local. No se crea una base alternativa.');}finally{await client.end();}
 await separateAccounts(config);
 return readLocalPostgres();
}
async function separateAccounts(config){
 validateAccounts(config);
 const {Client}=await import('pg');
 if(!config.accounts){
  // Existing demo identity includes its old username. Keep it until explicitly adopted.
  config.legacyDemo=config.legacyDemo!==false;
  config.accounts=Object.fromEntries(['dev','demo','test'].map(kind=>[kind,{role:`focus_${kind}_runtime`,password:randomBytes(32).toString('base64url')}]));
  store(config);
 }
 const admin=new Client({host:'127.0.0.1',port:config.port,user:'focus',password:config.password,database:'postgres',connectionTimeoutMillis:5000});
 try{
  await admin.connect();
  for(const kind of ['dev','demo','test']){
   const account=config.accounts[kind],database=`focus_${kind}`;
   if(!account||account.role!==`${database}_runtime`||typeof account.password!=='string'||!account.password)throw Error('Configuración de cuentas locales incompatible; no se reemplaza.');
   const role=(await admin.query('SELECT rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls FROM pg_roles WHERE rolname=$1',[account.role])).rows[0];
   if(!role){
    if(config.accountsReady)throw Error('Falta una cuenta PostgreSQL ya inicializada. Recupera configuración y permisos; no se regenera.');
    // PostgreSQL DDL does not bind role/password positions. PostgreSQL itself quotes
    // both supplied values through format; no secret enters argv or logs.
    const ddl=(await admin.query("SELECT format('CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD %L',$1::text,$2::text) AS sql",[account.role,account.password])).rows[0].sql;
    await admin.query(ddl);
   }else if(role.rolsuper||role.rolcreatedb||role.rolcreaterole||role.rolreplication||role.rolbypassrls)throw Error('Una cuenta de aplicación tiene privilegios inesperados; no se adopta.');
   const found=(await admin.query('SELECT 1 FROM pg_database WHERE datname=$1',[database])).rows.length;
   if(!found){
    if(config.accountsReady)throw Error('Falta una base PostgreSQL previamente separada. No se crea un reemplazo vacío.');
    await admin.query(`CREATE DATABASE ${database} OWNER ${account.role}`);
   }
   await admin.query(`GRANT CREATE,TEMPORARY ON DATABASE ${database} TO ${account.role}`);
   await admin.query(`REVOKE CONNECT ON DATABASE ${database} FROM PUBLIC`);
   await admin.query(`GRANT CONNECT ON DATABASE ${database} TO ${account.role}`);
   const db=new Client({host:'127.0.0.1',port:config.port,user:'focus',password:config.password,database,connectionTimeoutMillis:5000});
   try{
    await db.connect();
    await db.query(`GRANT USAGE,CREATE ON SCHEMA public TO ${account.role}`);
    // Existing canonical records and IDs remain untouched. Legacy-created tables
    // can be used by the dedicated role without changing their owner or contents.
    await db.query(`GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO ${account.role}`);
    await db.query(`GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO ${account.role}`);
   }finally{await db.end();}
   const check=new Client({host:'127.0.0.1',port:config.port,user:account.role,password:account.password,database,connectionTimeoutMillis:5000});
   try{await check.connect();await check.query('SELECT 1');}finally{await check.end();}
  }
  config.accountsReady=true;store(config);
 }catch{throw Error('No se pudo verificar la separación de cuentas PostgreSQL. Se conservan datos y credenciales; no se muestran secretos.');}
 finally{await admin.end();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const mode=process.argv[2]||'setup';
  if(!['setup','run'].includes(mode))throw Error('Uso: node scripts/dev-postgres.mjs setup | run [--database dev|demo|test] COMANDO [argumentos]');
  if(process.env.NODE_ENV==='production'&&process.env.FOCUS_DEMO==='true')throw Error('Producción no admite FOCUS_DEMO=true.');
  if(mode==='run'&&process.env.NODE_ENV==='production'&&!process.env.DATABASE_URL)throw Error('Producción requiere DATABASE_URL explícita, sin fallback local.');
  const local=mode==='run'&&process.env.DATABASE_URL?null:await getLocalPostgres();
  if(mode==='setup')console.log('PostgreSQL local preparado: dev/demo/test y cuentas dedicadas, puerto solo loopback. Configuración privada en .data/postgres-local.json.');
  else{
   const remaining=process.argv.slice(3);let selected='demo';
   if(remaining[0]==='--database'){remaining.shift();selected=remaining.shift();if(!['dev','demo','test'].includes(selected))throw Error('Selecciona --database dev|demo|test.');}
   const [command,...args]=remaining;if(!command)throw Error('Falta el comando explícito.');
   const selectedUrl=local&&(selected==='dev'?local.developmentUrl:selected==='test'?local.testDatabaseUrl:local.demoDatabaseUrl);
   const env={...process.env,DATABASE_URL:process.env.DATABASE_URL||selectedUrl,DATABASE_SCHEMA:process.env.DATABASE_SCHEMA||'public',FOCUS_DEMO:'false'};
   if(env.FOCUS_DB)throw Error('FOCUS_DB corresponde a SQLite. No lo uses para arrancar PostgreSQL.');
   const child=spawn(command,args,{env,stdio:'inherit'});
   child.once('error',()=>{console.error('No se pudo iniciar el comando PostgreSQL.');process.exitCode=1;});
   child.once('exit',(code,signal)=>{process.exitCode=code??(signal?1:0);});
   for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>child.kill(signal));
  }
 }catch(error){console.error(error.message);process.exitCode=1;}
}
