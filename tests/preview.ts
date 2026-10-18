// Isolated fictional browser fixture. Never touches the owner's development database.
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createTestDatabase} from './postgres-fixture.ts';
import {createOwner} from '../server/auth.ts';
import {createApp} from '../server/app.ts';
const dir=mkdtempSync(join(tmpdir(),'focus-browser-'));
const fixtureDB=await createTestDatabase(); const db=fixtureDB.db;
await createOwner(db,{email:'browser@example.test',password:'Browser-QA-fictional-2026!',display_name:'Cuenta ficticia QA'});
// Independent feature suite: successful logins also consume the security budget.
await createOwner(db,{email:'ux-browser@example.test',password:'UX-QA-fictional-2026!',display_name:'Cuenta ficticia UX'});
await createOwner(db,{email:'language-browser@example.test',password:'Language-QA-fictional-2026!',display_name:'Cuenta ficticia idiomas'});
await createOwner(db,{email:'journal-feed@example.test',password:'Journal-Feed-fictional-2026!',display_name:'Diario ficticio QA'});
await createOwner(db,{email:'brand-browser@example.test',password:'Brand-QA-fictional-2026!',display_name:'Cuenta ficticia de marca'});
const server=createApp(db).listen(4173,'127.0.0.1');
for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,()=>server.close(async()=>{await fixtureDB.close();rmSync(dir,{recursive:true,force:true});process.exit(0);}));
