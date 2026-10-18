import {spawn} from 'node:child_process';
import {getLocalPostgres} from './dev-postgres.mjs';

try{
 const [mode,...args]=process.argv.slice(2);
 if(!['unit','e2e','screenshots','brand','visual'].includes(mode))throw Error('Uso: node scripts/test-postgres.mjs unit|e2e|screenshots|brand|visual [argumentos]');
 let url=process.env.TEST_DATABASE_URL;
 if(url){
  let target;try{target=new URL(url);}catch{throw Error('TEST_DATABASE_URL inválida.');}
  if(!['postgres:','postgresql:'].includes(target.protocol))throw Error('Los tests requieren PostgreSQL.');
  if(!['127.0.0.1','localhost','[::1]'].includes(target.hostname)&&process.env.TEST_ALLOW_REMOTE_POSTGRES!=='true')throw Error('Tests remotos deshabilitados. Usa PostgreSQL local o autoriza explícitamente TEST_ALLOW_REMOTE_POSTGRES=true para un destino ficticio dedicado.');
 }else url=(await getLocalPostgres()).testDatabaseUrl;
 // Never propagate an application's DATABASE_URL into test fixtures by accident.
 const env={...process.env,TEST_DATABASE_URL:url};delete env.DATABASE_URL;delete env.DATABASE_SCHEMA;delete env.FOCUS_DB;
 const scripts={screenshots:'scripts/ux-v11-screenshots.ts',brand:'scripts/brand-screenshots.ts',visual:'scripts/refactor-visual.ts'};
 const command=mode==='unit'?['--import','tsx','--test','--test-concurrency=2','tests/*.test.ts',...args]:mode==='e2e'?['node_modules/@playwright/test/cli.js','test',...args]:['--import','tsx',scripts[mode],...args];
 const child=spawn(process.execPath,command,{env,stdio:'inherit'});
 child.once('error',()=>{console.error('No se pudo iniciar la suite.');process.exitCode=1;});
 child.once('exit',(code,signal)=>{process.exitCode=code??(signal?1:0);});
 for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>child.kill(signal));
}catch(error){console.error(error.message);process.exitCode=1;}
