import {openDatabase} from '../server/db.ts';
import {importSqliteDatabase} from '../server/sqlite-import.ts';
const args=process.argv.slice(2);
if(args.length!==2||args[0]!=='--source'||!args[1]){console.error('Usage: migrate-sqlite.ts --source EXPLICIT_SQLITE_PATH; DATABASE_URL must identify an empty migrated PostgreSQL destination.');process.exitCode=1;}
else{let db;try{if(!process.env.DATABASE_URL)throw Error('DATABASE_URL is required; no destination is created automatically.');db=await openDatabase();console.log(JSON.stringify(await importSqliteDatabase(args[1],db),null,2));}catch{console.error('SQLite migration failed or its commit could not be confirmed. Inspect the chosen destination before retrying; preserve the source and backup. No credentials or records are logged.');process.exitCode=1;}finally{await db?.close();}}
