import {Pool,type PoolClient,type QueryResult,type QueryResultRow} from 'pg';
import {AsyncLocalStorage} from 'node:async_hooks';
import {createHash,randomUUID} from 'node:crypto';
import {readFileSync,readdirSync} from 'node:fs';

export type Row = Record<string,any>;
export type DatabaseOptions = {schema?:string;migrate?:boolean;max?:number};
const migrationsDirectory=new URL('../migrations/postgres/',import.meta.url);
const migrationFiles=()=>readdirSync(migrationsDirectory).filter(name=>/^\d{3}_[a-z_]+\.sql$/.test(name)).sort().map(name=>{
 const sql=readFileSync(new URL(name,migrationsDirectory),'utf8');
 return {version:Number(name.slice(0,3)),name,sql,checksum:createHash('sha256').update(sql).digest('hex')};
});
export function schemaName(value=process.env.DATABASE_SCHEMA||'public'){
 if(!/^[a-z][a-z0-9_]{0,62}$/.test(value))throw Error('DATABASE_SCHEMA no es válido.');return value;
}
function connectionURL(value=process.env.DATABASE_URL){
 if(!value)throw Error('Configura DATABASE_URL explícitamente; SQLite no se sustituye automáticamente.');
 let url:URL;try{url=new URL(value);}catch{throw Error('DATABASE_URL no es válida.');}
 if(!['postgres:','postgresql:'].includes(url.protocol)||!url.hostname||url.pathname.length<2||url.hash)throw Error('DATABASE_URL debe identificar una base PostgreSQL concreta.');
 return url;
}
export function databaseIdentity(value?:string,schema=schemaName()){
 const url=connectionURL(value);
 return 'pg:'+createHash('sha256').update(JSON.stringify([url.hostname,url.port||'5432',decodeURIComponent(url.pathname.slice(1)),decodeURIComponent(url.username),schema])).digest('hex');
}
function poolConfig(value:string|undefined,options:DatabaseOptions){
 const url=connectionURL(value),local=['localhost','127.0.0.1','[::1]'].includes(url.hostname);
 const mode=url.searchParams.get('sslmode');
 if(mode&&!['disable','require','verify-ca','verify-full'].includes(mode))throw Error('sslmode no admitido; usa verify-full para conexiones remotas.');
 if(!local&&mode==='disable')throw Error('PostgreSQL remoto requiere TLS con certificado verificado.');
 // Never let sslmode=require from a URL silently disable certificate verification.
 for(const key of ['sslmode','sslcert','sslkey','sslrootcert','uselibpqcompat'])url.searchParams.delete(key);
 if([...url.searchParams.keys()].some(key=>!['application_name'].includes(key)))throw Error('Parámetro DATABASE_URL no admitido.');
 const maximum=options.max??Number(process.env.PG_POOL_MAX||4);
 if(!Number.isInteger(maximum)||maximum<1||maximum>20)throw Error('PG_POOL_MAX debe estar entre 1 y 20.');
 return {connectionString:url.toString(),max:maximum,connectionTimeoutMillis:5000,idleTimeoutMillis:10000,
  statement_timeout:15000,lock_timeout:10000,application_name:'focus-hub',
  options:`-c search_path=${schemaName(options.schema)},pg_catalog`,
  ssl:local&&(!mode||mode==='disable')?false:{rejectUnauthorized:true},
 };
}

/** A pool and a transaction-scoped client; no SQL dialect emulation. */
export class Database {
 private readonly pool:Pool;
 private readonly context=new AsyncLocalStorage<PoolClient>();
 readonly schema:string;
 readonly identity:string;
 constructor(value:string|undefined,options:DatabaseOptions={}){
  this.schema=schemaName(options.schema);this.identity=databaseIdentity(value,this.schema);
  this.pool=new Pool(poolConfig(value,options));
  // Idle connection failures must not crash the process or log connection secrets.
  this.pool.on('error',()=>console.error('FOCUS_POSTGRES_IDLE_CONNECTION_ERROR'));
 }
 query<R extends QueryResultRow=Row>(sql:string,params:unknown[]=[]):Promise<QueryResult<R>>{
  return (this.context.getStore()??this.pool).query<R>(sql,params);
 }
 async one<R extends QueryResultRow=Row>(sql:string,params:unknown[]=[]):Promise<R|undefined>{return (await this.query<R>(sql,params)).rows[0];}
 async all<R extends QueryResultRow=Row>(sql:string,params:unknown[]=[]):Promise<R[]>{return (await this.query<R>(sql,params)).rows;}
 async run(sql:string,params:unknown[]=[]){return {changes:(await this.query(sql,params)).rowCount??0};}
 async exec(sql:string):Promise<void>{await this.query(sql);}
 async close():Promise<void>{await this.pool.end();}
 async transaction<T>(action:()=>Promise<T>):Promise<T>{
  const current=this.context.getStore();
  if(current){
   const savepoint='sp_'+randomUUID().replaceAll('-','');await current.query(`SAVEPOINT ${savepoint}`);
   try{const result=await action();await current.query(`RELEASE SAVEPOINT ${savepoint}`);return result;}
   catch(error){await current.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);await current.query(`RELEASE SAVEPOINT ${savepoint}`);throw error;}
  }
  const client=await this.pool.connect();
  try{await client.query('BEGIN');return await this.context.run(client,async()=>{
   try{const result=await action();await client.query('COMMIT');return result;}
   catch(error){await client.query('ROLLBACK');throw error;}
  });}finally{client.release();}
 }
}
export const transaction=<T>(db:Database,action:()=>Promise<T>)=>db.transaction(action);

export async function migrateDatabase(db:Database){
 const files=migrationFiles();
 await transaction(db,async()=>{
  await db.query('SELECT pg_advisory_xact_lock(hashtext(current_database()),hashtext($1))',['focus:migrations:'+db.schema]);
  await db.exec('CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY,name TEXT NOT NULL,checksum TEXT NOT NULL,applied_at TEXT NOT NULL)');
  const applied=await db.all('SELECT version,name,checksum FROM schema_migrations ORDER BY version');
  if(!applied.length){
   const existing=await db.one(`SELECT table_name FROM information_schema.tables WHERE table_schema=$1 AND table_name=ANY($2::text[]) LIMIT 1`,[db.schema,['users','workspaces','workspace_members','sessions','strategic_goals','projects','milestones','tasks','task_events','journal_entries','journal_blocks','focus_items','idempotency_keys']]);
   if(existing)throw Error('Existen tablas Focus sin ledger de migraciones. No se adopta ni sobrescribe el esquema.');
  }
  for(const row of applied){const file=files.find(file=>file.version===row.version);if(!file||file.name!==row.name||file.checksum!==row.checksum)throw Error('Migraciones PostgreSQL incompatibles o modificadas; no se continúa.');}
  for(const file of files)if(!applied.some(row=>row.version===file.version)){
   await db.exec(file.sql);await db.run('INSERT INTO schema_migrations(version,name,checksum,applied_at) VALUES($1,$2,$3,$4)',[file.version,file.name,file.checksum,new Date().toISOString()]);
  }
 });
}
export async function verifyMigrations(db:Database){
 const table=await db.one('SELECT to_regclass($1) AS name',[`${db.schema}.schema_migrations`]);
 if(!table?.name)throw Error('Faltan migraciones PostgreSQL. Ejecuta npm run db:migrate sobre el destino elegido.');
 const applied=await db.all('SELECT version,name,checksum FROM schema_migrations ORDER BY version'),files=migrationFiles();
 if(applied.length!==files.length||files.some((file,index)=>file.version!==applied[index]?.version||file.name!==applied[index]?.name||file.checksum!==applied[index]?.checksum))throw Error('Esquema PostgreSQL incompleto o incompatible; no se crea una base de reemplazo.');
 return applied;
}
export async function openDatabase(value?:string,options:DatabaseOptions={}){
 if(process.env.NODE_ENV==='production'&&process.env.FOCUS_DEMO==='true')throw Error('Producción no admite FOCUS_DEMO=true. Configura un destino PostgreSQL independiente.');
 if(process.env.FOCUS_DB)throw Error("FOCUS_DB identifica SQLite heredado. Conserva su copia y configura PostgreSQL explícitamente antes de iniciar.");
 const db=new Database(value,options);
 try{
  const schema=await db.one('SELECT to_regnamespace($1) AS name',[db.schema]);if(!schema?.name)throw Error('El esquema PostgreSQL seleccionado no existe.');
  if(options.migrate)await migrateDatabase(db);else await verifyMigrations(db);
  return db;
 }catch(error){await db.close();throw error;}
}
