import {backupDatabase,verifyDatabase,restoreDatabase} from '../server/recovery.ts';
const [command,...args]=process.argv.slice(2);
try {
 const values:Record<string,string>={};
 for(let i=0;i<args.length;i+=2){if(!['--source','--out'].includes(args[i])||!args[i+1]||values[args[i]])throw Error('Usa --source RUTA y --out RUTA (salvo verify).');values[args[i]]=args[i+1];}
 const source=values['--source']||process.env.FOCUS_DB||'.data/demo.sqlite';
 if(!['backup','verify','restore'].includes(command))throw Error('Uso: database.ts backup|verify|restore --source RUTA [--out RUTA_NUEVA]');
 if(command==='verify'&&values['--out'])throw Error('verify no acepta --out.');
 if(command!=='verify'&&!values['--out'])throw Error('Es obligatorio indicar --out con una ruta nueva.');
 const result=command==='verify'?verifyDatabase(source):await(command==='backup'?backupDatabase(source,values['--out']):restoreDatabase(source,values['--out']));
 console.log(JSON.stringify(result,null,2));
}catch(error){console.error(error instanceof Error?error.message:'No se pudo completar la recuperación.');process.exitCode=1;}
