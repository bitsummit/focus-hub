import { DatabaseSync } from 'node:sqlite';
import {mkdirSync,readFileSync,chmodSync,existsSync} from 'node:fs';
import {dirname} from 'node:path';
export function openDatabase(path:string) {
 if(path!==':memory:') mkdirSync(dirname(path),{recursive:true,mode:0o700});
 const db=new DatabaseSync(path);
 // SQLite/WAL contain private records even when the configured DB lives outside .data.
 try {
  if(path!==':memory:')chmodSync(path,0o600);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  if(path!==':memory:')for(const suffix of ['-wal','-shm'])if(existsSync(path+suffix))chmodSync(path+suffix,0o600);
 }catch(error){db.close();throw error;}
 db.exec(readFileSync(new URL('../migrations/001_initial.sql',import.meta.url),'utf8')); return db;
}
export function transaction<T>(db:DatabaseSync, action:()=>T):T {db.exec('BEGIN IMMEDIATE');try{const result=action();db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}}
