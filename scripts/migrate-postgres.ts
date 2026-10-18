import {openDatabase} from '../server/db.ts';
try{const db=await openDatabase(undefined,{migrate:true});await db.close();console.log('Migraciones PostgreSQL verificadas y aplicadas.');}
catch{console.error('No se pudieron aplicar las migraciones PostgreSQL. Revisa destino, permisos y compatibilidad; no se ha creado una base de reemplazo.');process.exitCode=1;}
