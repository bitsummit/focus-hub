import {closeSync,existsSync,fsyncSync,lstatSync,openSync,readFileSync,renameSync,unlinkSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {openDatabase,transaction,type Database} from './db.ts';
import {createInterface} from 'node:readline/promises';
import {stdin,stdout} from 'node:process';
import {Writable} from 'node:stream';
import {changePassword} from './auth.ts';

class InputError extends Error {}
function fail(message:string):never{throw new InputError(message);}
const regularFile=(path:string)=>{if(!existsSync(path)||!lstatSync(path).isFile()||lstatSync(path).isSymbolicLink())fail('Se requiere un archivo local existente, sin enlaces simbólicos.');};
// Both staged files live on the same filesystem as the access file. Atomic rename
// plus an outer database transaction supports rollback on ordinary I/O/commit errors.
// This is not a distributed transaction: never interrupt the command mid-rotation.
function stage(path:string,content:string){
 const temporary=join(dirname(path),`.password-${randomUUID()}.tmp`);
 const fd=openSync(temporary,'wx',0o600);
 try{writeFileSync(fd,content);fsyncSync(fd);}catch(error){closeSync(fd);unlinkSync(temporary);throw error;}
 closeSync(fd);return temporary;
}

let cleanup=()=>{};
let db:Database|undefined;
let staged:string|undefined,backup:string|undefined,accessOriginal:string|undefined;
try{
 if(process.argv.length>2)fail('No se aceptan argumentos. Introduce los datos mediante la terminal o entrada estándar.');
 // Connecting never creates a database or applies migrations implicitly.
 db=await openDatabase();
 let email:string,password:string;
 if(stdin.isTTY){
  let hidden=false;
  const masked=new Writable({write(chunk,_encoding,callback){if(!hidden)stdout.write(chunk);callback();}});
  const rl=createInterface({input:stdin,output:masked,terminal:true});cleanup=()=>rl.close();
  email=await rl.question('Correo de la cuenta: ');
  stdout.write('Nueva contraseña (12–256 caracteres; entrada oculta): ');
  hidden=true;password=await rl.question('');hidden=false;stdout.write('\n');
  stdout.write('Repite la nueva contraseña (entrada oculta): ');
  hidden=true;const confirmation=await rl.question('');hidden=false;stdout.write('\n');
  if(password!==confirmation)fail('Las contraseñas no coinciden. No se ha cambiado la cuenta.');
 }else{
  let input='';
  for await(const chunk of stdin){input+=chunk.toString();if(Buffer.byteLength(input,'utf8')>4096)fail('Entrada demasiado larga.');}
  const lines=input.split(/\r?\n/);
  if(lines.length===3&&lines[2]==='')lines.pop();
  if(lines.length!==2)fail('Entrada estándar: correo y nueva contraseña en dos líneas.');
  [email,password]=lines;
 }
 email=email.trim().toLowerCase();
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254)fail('Correo no válido.');
 if(password.length<12||password.length>256)fail('La contraseña debe tener entre 12 y 256 caracteres.');
 const accessPath=resolve('.data/demo-access.json');
 const demoRequired=process.env.FOCUS_DEMO==='true';
 if(demoRequired||existsSync(accessPath)){
  if(lstatSync(dirname(accessPath)).isSymbolicLink())fail('La carpeta de la demo no puede ser un enlace simbólico.');
  regularFile(accessPath);
  const original=readFileSync(accessPath,'utf8');
  let access:unknown;
  try{access=JSON.parse(original);}catch{fail('Metadatos de acceso de la demo no válidos.');}
  if(!access||Array.isArray(access)||typeof access!=='object'||!('database' in access)||typeof access.database!=='string')fail('Metadatos de acceso de la demo no válidos.');
  if(demoRequired&&access.database!==db.identity)fail('Los metadatos no corresponden a esta base demo. No se ha cambiado la cuenta.');
  if(access.database===db.identity){
   if(!('email' in access)||access.email!==email||!('password' in access)||typeof access.password!=='string'||!access.password)fail('Los metadatos no corresponden a esta cuenta demo. No se ha cambiado la cuenta.');
   accessOriginal=original;
   staged=stage(accessPath,JSON.stringify({...access,password},null,2)+'\n');
   backup=stage(accessPath,original);
  }
 }
 let renamed=false;
 try{
  await transaction(db,async()=>{
   // Serialize the metadata check with both rotation and login session issuance.
   // A concurrent CLI must observe metadata only after the previous rotation commits.
   const user=await db!.one('SELECT id FROM users WHERE focus_ascii_fold(email)=focus_ascii_fold($1) FOR UPDATE',[email]);
   if(!user)fail('No se encontró la cuenta indicada');
   if(accessOriginal!==undefined){
    regularFile(accessPath);
    if(readFileSync(accessPath,'utf8')!==accessOriginal)fail('El archivo de acceso ha cambiado. Vuelve a ejecutar el comando.');
   }
   await changePassword(db!,{email,password});
   if(staged){renameSync(staged,accessPath);staged=undefined;renamed=true;}
  });
 }catch(error){
  if(renamed&&backup){
   const recovery=backup;
   try{renameSync(recovery,accessPath);backup=undefined;}catch{
    // Preserve the only original copy if rollback itself meets an I/O failure.
    backup=undefined;
    fail('La restauración del archivo de acceso necesita revisión local. Se conserva un respaldo .password-*.tmp en .data; no lo compartas.');
   }
  }
  throw error;
 }
 console.log('Contraseña actualizada. Todas las sesiones anteriores de esta cuenta se han cerrado.');
 if(backup)console.log('El archivo local de acceso de la demo también se ha actualizado (modo 0600).');
}catch(error){
 console.error(error instanceof InputError?error.message:'No se pudo cambiar la contraseña. Comprueba la cuenta y los archivos locales; no se muestran credenciales.');
 process.exitCode=1;
}finally{
 cleanup();await db?.close();
 for(const file of [staged,backup])if(file&&existsSync(file))unlinkSync(file);
}
