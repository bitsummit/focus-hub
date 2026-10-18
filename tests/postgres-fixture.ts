import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {openDatabase} from '../server/db.ts';

/** Every fixture owns one random schema; never falls back to the application's URL. */
export async function createTestDatabase(){
 const url=process.env.TEST_DATABASE_URL;
 if(!url)throw Error('TEST_DATABASE_URL is required; use the isolated local PostgreSQL test database.');
 const parsed=new URL(url);
 if(!['postgres:','postgresql:'].includes(parsed.protocol))throw Error('PostgreSQL TEST_DATABASE_URL required');
 if(!['localhost','127.0.0.1','[::1]'].includes(parsed.hostname)&&process.env.TEST_ALLOW_REMOTE_POSTGRES!=='true')throw Error('Refusing nonlocal test database without TEST_ALLOW_REMOTE_POSTGRES=true');
 const schema=`focus_test_${randomUUID().replaceAll('-','')}`;
 const pool=new Pool({connectionString:url,max:1});
 await pool.query(`CREATE SCHEMA "${schema}"`);
 try{
  const db=await openDatabase(url,{schema,migrate:true});
  let closed=false;
  return {db,url,schema,connectionString:url,async close(){if(closed)return;closed=true;await db.close();try{await pool.query(`DROP SCHEMA "${schema}" CASCADE`);}finally{await pool.end();}}};
 }catch(error){try{await pool.query(`DROP SCHEMA "${schema}" CASCADE`);}finally{await pool.end();}throw error;}
}
