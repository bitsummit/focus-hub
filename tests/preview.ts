// Isolated fictional browser fixture. Never touches the owner's development database.
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openDatabase} from '../server/db.ts';
import {createOwner} from '../server/auth.ts';
import {createApp} from '../server/app.ts';
const dir=mkdtempSync(join(tmpdir(),'focus-browser-'));
const db=openDatabase(join(dir,'browser.sqlite'));
createOwner(db,{email:'browser@example.test',password:'Browser-QA-fictional-2026!',display_name:'Cuenta ficticia QA'});
createOwner(db,{email:'language-browser@example.test',password:'Language-QA-fictional-2026!',display_name:'Cuenta ficticia idiomas'});
createOwner(db,{email:'journal-feed@example.test',password:'Journal-Feed-fictional-2026!',display_name:'Diario ficticio QA'});
const server=createApp(db).listen(4173,'127.0.0.1');
for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,()=>server.close(()=>{db.close();rmSync(dir,{recursive:true,force:true});process.exit(0);}));
