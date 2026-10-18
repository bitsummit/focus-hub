import {createInterface} from 'node:readline/promises';
import {stdin,stdout} from 'node:process';
import {Writable} from 'node:stream';
import {openDatabase,transaction,type Database} from './db.ts';
import {createOwner} from './auth.ts';
// Passwords arrive through a masked terminal or stdin, never command arguments.
let db:Database|undefined;
let cleanup=()=>{};
try{
 if(process.argv.length>2)throw new Error('No se aceptan argumentos. Introduce los datos mediante la terminal o entrada estándar.');
 db=await openDatabase();
 if(await db.one('SELECT id FROM users LIMIT 1'))throw new Error('Ya existe un propietario. No se habilita el registro público.');
 let email:string,display_name:string,password:string;
 if(stdin.isTTY){
  let hidden=false;const masked=new Writable({write(chunk,_encoding,callback){if(!hidden)stdout.write(chunk);callback();}});
  const rl=createInterface({input:stdin,output:masked,terminal:true});cleanup=()=>rl.close();
  email=await rl.question('Correo del propietario: ');display_name=await rl.question('Nombre visible: ');
  stdout.write('Contraseña (mínimo 12 caracteres; entrada oculta): ');hidden=true;password=await rl.question('');hidden=false;stdout.write('\n');
 }else{
  let input='';for await(const chunk of stdin){input+=chunk.toString();if(input.length>4096)throw new Error('Entrada demasiado larga');}
  const lines=input.split(/\r?\n/);if(lines.length<3)throw new Error('Entrada estándar: correo, nombre y contraseña en tres líneas');
  [email,display_name,password]=lines;
 }
 await transaction(db,async()=>{
  await db!.query("SELECT pg_advisory_xact_lock(hashtext('focus_owner_bootstrap'))");
  if(await db!.one('SELECT id FROM users LIMIT 1'))throw new Error('Ya existe un propietario. No se habilita el registro público.');
  await createOwner(db!,{email,password,display_name});
 });
 console.log('Propietario creado. Ya puedes iniciar sesión.');
}catch(error){
 const message=(error as Error).message;
 const safe=['No se aceptan argumentos. Introduce los datos mediante la terminal o entrada estándar.','Ya existe un propietario. No se habilita el registro público.','Correo no válido','La contraseña debe tener entre 12 y 256 caracteres','Entrada demasiado larga','Entrada estándar: correo, nombre y contraseña en tres líneas'];
 console.error(safe.includes(message)?message:'No se pudo crear el propietario. Comprueba DATABASE_URL y las migraciones; no se muestran credenciales.');process.exitCode=1;
}finally{cleanup();await db?.close();}
