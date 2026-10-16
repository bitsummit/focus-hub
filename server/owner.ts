import {createInterface} from 'node:readline/promises';
import {stdin,stdout} from 'node:process';
import {resolve} from 'node:path';
import {Writable} from 'node:stream';
import {openDatabase} from './db.ts';
import {createOwner} from './auth.ts';
// Passwords arrive through a masked terminal or stdin, never command arguments.
const db=openDatabase(resolve(process.env.FOCUS_DB||'.data/focus-hub.sqlite'));
let cleanup=()=>{};
try{
 if(db.prepare('SELECT id FROM users LIMIT 1').get())throw new Error('Ya existe un propietario. No se habilita el registro público.');
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
 createOwner(db,{email,password,display_name});console.log('Propietario creado. Ya puedes iniciar sesión.');
}catch(error){console.error((error as Error).message);process.exitCode=1;}finally{cleanup();db.close();}
