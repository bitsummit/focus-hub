import {spawn} from 'node:child_process';
import {existsSync,readFileSync} from 'node:fs';
import {getLocalPostgres} from '../scripts/dev-postgres.mjs';

// Child environments carry secrets in memory, never shell arguments or logs.
export async function environment(){
 if(process.env.FOCUS_DB)throw Error('FOCUS_DB corresponde a SQLite. Conserva la base y sigue la migración explícita en docs/OPERATIONS.md.');
 if(process.env.DATABASE_URL)return {...process.env,FOCUS_DEMO:'false'};
 const accessPath='.data/demo-access.json';
 if(existsSync(accessPath)){
  let access;try{access=JSON.parse(readFileSync(accessPath,'utf8'));}catch{throw Error('Archivo de acceso ilegible. Se conserva sin sobrescribir.');}
  if(typeof access.database!=='string'||!access.database.startsWith('pg:'))throw Error('La demo anterior usa SQLite. Migra explícitamente siguiendo docs/OPERATIONS.md; no se reemplazan bases ni credenciales.');
 }else if(existsSync('.data/demo.sqlite'))throw Error('Existe una demo SQLite sin metadatos PostgreSQL. Sigue la migración explícita en docs/OPERATIONS.md; no se crea una demo sustituta.');
 const local=await getLocalPostgres();
 return {...process.env,DATABASE_URL:local.databaseUrl,DATABASE_SCHEMA:'public',FOCUS_DEMO:'true'};
}
export function run(command,args,env){return new Promise((done,reject)=>{
 const child=spawn(command,args,{env,stdio:'inherit'});
 child.once('error',()=>reject(Error('No se pudo iniciar el comando de preparación.')));
 child.once('exit',code=>code===0?done():reject(Error('El comando ha fallado; no se sustituyen datos ni destinos.')));
});}
try{
 if(process.argv[2]==='setup'){
  const env=await environment();
  if(env.FOCUS_DEMO!=='true')console.log('DATABASE_URL explícita: no se migra ni se siembra automáticamente. Prepara conscientemente el destino con npm run db:migrate.');
  else{
   await run('npm',['run','db:migrate'],env);
   if(!existsSync('.data/demo-access.json'))await run('npm',['run','demo'],env);
   else{
    const {openDatabase}=await import('../server/db.ts');
    const db=await openDatabase(env.DATABASE_URL,{schema:env.DATABASE_SCHEMA});
    try{
     const access=JSON.parse(readFileSync('.data/demo-access.json','utf8'));
     if(access.database!==db.identity||!await db.one('SELECT id FROM users LIMIT 1'))throw Error('Demo incompleta o destino diferente. No se sobrescribe; revisa la recuperación en docs/OPERATIONS.md.');
    }finally{await db.close();}
   }
   console.log('Demo PostgreSQL preparada. Abre .data/demo-access.json en el editor para acceder; no lo compartas.');
  }
 }else if(process.argv[2]==='start')await run(process.execPath,['--import','tsx','.devcontainer/service.mjs','start'],await environment());
 else if(process.argv[2]==='run'){
  const [command,...args]=process.argv.slice(3);if(!command)throw Error('Uso: node --import tsx .devcontainer/postgres.mjs run COMANDO [argumentos]');
  await run(command,args,await environment());
 }
}catch(error){console.error(error.message);process.exitCode=1;}
