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
 try {
  // Serialize the additive migration check, including simultaneous server/CLI opens.
  db.exec('BEGIN IMMEDIATE');
  db.exec(readFileSync(new URL('../migrations/001_initial.sql',import.meta.url),'utf8'));
  if(!db.prepare('PRAGMA table_info(users)').all().some(column=>column.name==='language'))
   db.exec(readFileSync(new URL('../migrations/002_language.sql',import.meta.url),'utf8'));
  db.exec('COMMIT');
  if(path!==':memory:')for(const suffix of ['-wal','-shm'])if(existsSync(path+suffix))chmodSync(path+suffix,0o600);
  return db;
 }catch(error){try{db.exec('ROLLBACK');}catch{}db.close();throw error;}
}
export function transaction<T>(db:DatabaseSync, action:()=>T):T {db.exec('BEGIN IMMEDIATE');try{const result=action();db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}}
