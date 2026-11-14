import {rehearsePostgresRecovery} from '../server/recovery-rehearsal.ts';
const args=process.argv.slice(2);
try{
 if(args.length!==2||args[0]!=='--source'||!args[1])throw Error('Explicit backup path required.');
 if(!process.env.DATABASE_URL)throw Error('Explicit PostgreSQL URL required.');
 const result=await rehearsePostgresRecovery(process.env.DATABASE_URL,process.env.DATABASE_SCHEMA||'public',args[1]);
 console.log(JSON.stringify(result,null,2));
}catch{
 console.error('Recovery rehearsal failed. Verify the explicit connection, compatible backup and CREATE SCHEMA permission. No source records or backup files were replaced; no credentials are logged. If interrupted, inspect only schemas named focus_recovery_<UUID> before cleanup.');
 process.exitCode=1;
}
