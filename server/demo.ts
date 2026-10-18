import {mkdirSync,writeFileSync,lstatSync,linkSync,unlinkSync,openSync,closeSync,fsyncSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {openDatabase,transaction,type Database} from './db.ts';
import {createOwner} from './auth.ts';
import {Domain} from './domain.ts';
import {localDate,periodStart,addDays} from './calendar.ts';
// Explicit fictional seeding: never replace accounts, an access file or an old database.
class DemoError extends Error {}
const accessPath=resolve('.data/demo-access.json');
let db:Database|undefined,staged:string|undefined,installed:{dev:number;ino:number}|undefined;
function present(path:string){try{lstatSync(path);return true;}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return false;throw error;}}
try{
 if(process.argv.length>2)throw new DemoError('La demo no acepta argumentos. Configura DATABASE_URL explícitamente.');
 if(present(accessPath))throw new DemoError('Ya existe un archivo de acceso. Se conserva sin sobrescribirlo; verifica el destino antes de continuar.');
 mkdirSync(dirname(accessPath),{recursive:true,mode:0o700});
 if(lstatSync(dirname(accessPath)).isSymbolicLink())throw new DemoError('La carpeta de la demo no puede ser un enlace simbólico.');
 db=await openDatabase();
 const database=db;
 const password=randomBytes(24).toString('base64url');
 await transaction(database,async()=>{
  await database.query("SELECT pg_advisory_xact_lock(hashtext('focus_owner_bootstrap'))");
  // All canonical records depend on users through enforced foreign keys. Holding
  // this table lock prevents a simultaneous owner bootstrap from racing emptiness.
  await database.exec('LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE');
  if(await database.one('SELECT id FROM users LIMIT 1'))throw new DemoError('El destino contiene cuentas/datos. La demo no modifica bases existentes.');
  if(present(accessPath))throw new DemoError('El archivo de acceso ha aparecido durante la preparación. No se sobrescribe.');
  const user=await createOwner(database,{email:'demo@example.test',password,display_name:'Espacio de demostración'});
  const workspace=(await database.one('SELECT id FROM workspaces WHERE owner_user_id=$1',[user.id]))!;
  const d=new Domain(database,{user_id:user.id,workspace_id:String(workspace.id)});
  const goal=await d.createEntity('goals',{title:'Dar forma a una idea',description:'Objetivo ficticio · convertir una idea pequeña en un resultado tangible.',period_start:'2026-10-01',period_end:'2026-12-31'});
  const project=await d.createEntity('projects',{name:'Estudio Aurora',slug:'aurora',description:'Proyecto ficticio · explorar una nueva identidad visual.',goal_id:goal.id,color:'#427c71'});
  const garden=await d.createEntity('projects',{name:'Jardín de ideas',slug:'jardin',description:'Proyecto ficticio · lecturas y pequeños experimentos.',color:'#bc8b4b'});
  await d.createEntity('milestones',{title:'Definir el punto de partida',goal_id:goal.id,project_id:project.id,status:'achieved'});
  await d.createEntity('milestones',{title:'Preparar la primera propuesta',goal_id:goal.id,project_id:project.id});
  const a=await d.capture({text:'!! Preparar propuesta visual #aurora',request_id:randomUUID()});
  const b=await d.capture({text:'! Elegir tres referencias #aurora',request_id:randomUUID()});
  const c=await d.capture({text:'Revisar la lista de lecturas #jardin',request_id:randomUUID()});
  const done=await d.capture({text:'Ordenar las primeras ideas #aurora',request_id:randomUUID()});
  await d.updateTask(a.id,{status:'in_progress',description:'Datos de demostración ficticios. Explorar una dirección tranquila y clara.'});
  await d.updateTask(b.id,{status:'waiting_external',waiting_on:'Revisión del equipo ficticio',follow_up_at:addDays(localDate(user.timezone),2)});
  await d.updateTask(done.id,{status:'completed'});
  const today=localDate(user.timezone);
  await d.setFocus('daily',today,[a.id,c.id]);await d.setFocus('weekly',periodStart(today,'weekly'),[a.id,b.id,c.id]);
  await d.appendBlock(today,{text:'# Estudio Aurora',request_id:randomUUID(),revision:0});
  await d.appendBlock(today,{text:'Este espacio contiene únicamente datos ficticios para probar Focus Hub.',request_id:randomUUID(),revision:1});
  await d.appendBlock(today,{text:'',task_id:a.id,request_id:randomUUID(),revision:2});
  staged=resolve('.data',`.demo-${randomUUID()}.tmp`);
  const fd=openSync(staged,'wx',0o600);
  try{writeFileSync(fd,JSON.stringify({email:user.email,password,database:database.identity,notice:'Credenciales locales generadas para datos ficticios. No subir a Git.'},null,2)+'\n');fsyncSync(fd);}finally{closeSync(fd);}
  const stat=lstatSync(staged);
  // Hard link publishes the complete file atomically and refuses any existing path.
  linkSync(staged,accessPath);installed={dev:stat.dev,ino:stat.ino};
 });
 console.log('Demo PostgreSQL ficticia creada. Acceso guardado localmente en .data/demo-access.json (modo 0600).');
 console.log('Arranca con DATABASE_URL configurada y npm start. No compartas el archivo de acceso.');
}catch(error){
 if(installed){
  try{const stat=lstatSync(accessPath);if(stat.dev===installed.dev&&stat.ino===installed.ino)unlinkSync(accessPath);}catch{/* Never remove a replacement file owned by another process. */}
 }
 console.error(error instanceof DemoError?error.message:'No se pudo preparar la demo. Comprueba DATABASE_URL y las migraciones; no se muestran credenciales.');
 process.exitCode=1;
}finally{
 if(staged&&present(staged))unlinkSync(staged);
 await db?.close();
}
