import {existsSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {openDatabase,type Database} from '../server/db.ts';
import {adoptLocalPostgres,LocalAdoptionError,type LocalDatabaseKind} from '../server/local-adoption.ts';
import {rehearsePostgresRecovery} from '../server/recovery-rehearsal.ts';

class AdoptionInputError extends Error {}
function stoppedManagedServer(){
 const path=resolve('.data/codespaces-server.pid');if(!existsSync(path))return;
 let value;try{value=JSON.parse(readFileSync(path,'utf8'));}catch{throw new AdoptionInputError('El PID gestionado no es válido. Revísalo sin borrar datos.');}
 const pid=typeof value==='number'?value:value.pid;
 if(!Number.isSafeInteger(pid)||pid<1)throw new AdoptionInputError('El PID gestionado no es válido. Revísalo sin borrar datos.');
 try{process.kill(pid,0);}catch(error){if(['ESRCH','ENOENT'].includes(String((error as NodeJS.ErrnoException).code)))return;throw error;}
 try{if(/\) Z /.test(readFileSync(`/proc/${pid}/stat`,'utf8')))return;}catch{}
 throw new AdoptionInputError('Detén el servidor gestionado y los servidores manuales antes de adoptar el destino. No se detiene ningún proceso automáticamente.');
}
let db:Database|undefined;
try{
 const args=process.argv.slice(2);
 if(args.length!==4||args[0]!=='--database'||!['demo','dev'].includes(args[1])||args[2]!=='--backup'||!args[3])throw new AdoptionInputError('Uso: npm run local:adopt -- --database demo|dev --backup RUTA_JSON');
 if(process.env.NODE_ENV==='production'||process.env.DATABASE_URL||process.env.FOCUS_DB||(process.env.DATABASE_SCHEMA&&process.env.DATABASE_SCHEMA!=='public'))throw new AdoptionInputError('La adopción es solo local: elimina DATABASE_URL/FOCUS_DB del comando, usa esquema public y no ejecutes en producción.');
 stoppedManagedServer();
 const localTools=await import(new URL('./dev-postgres.mjs',import.meta.url).href);
 localTools.readLocalPostgres(); // Never create a replacement config for an adopted database.
 const local=await localTools.getLocalPostgres(),kind=args[1] as LocalDatabaseKind;
 const url=kind==='demo'?local.demoDatabaseUrl:local.developmentUrl,expectedRole=`focus_${kind}_runtime`;
 if(typeof url!=='string'||decodeURIComponent(new URL(url).username)!==expectedRole)throw new AdoptionInputError('Falta la cuenta dedicada del destino local. No se selecciona la cuenta administrativa.');
 const rehearsal=await rehearsePostgresRecovery(url,'public',args[3]);
 db=await openDatabase(url,{schema:'public'});
 const binding=await adoptLocalPostgres(db,{kind,expectedRole,backupPath:args[3],expectedBackupSha256:rehearsal.backupSha256});
 console.log(JSON.stringify({status:'adopted',...binding,recoveryRehearsal:rehearsal.integrity,temporaryRecoverySchemaRemoved:rehearsal.temporarySchemaRemoved},null,2));
 console.log('Destino local adoptado sin cambiar tareas, credenciales ni archivos anteriores. Arranca con bash .devcontainer/start.sh.');
}catch(error){
 console.error(error instanceof AdoptionInputError||error instanceof LocalAdoptionError?error.message:'No se pudo adoptar el destino. Revisa backup, permisos y datos actuales; se conservan los archivos originales y no se muestran credenciales.');
 process.exitCode=1;
}finally{await db?.close();}
