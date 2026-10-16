import {resolve} from 'node:path';
import {openDatabase} from './db.ts';
import {createApp} from './app.ts';
const db=openDatabase(resolve(process.env.FOCUS_DB||'.data/focus-hub.sqlite'));
const port=Number(process.env.PORT||3000);
const server=createApp(db).listen(port,'127.0.0.1',()=>{console.log(`Focus Hub: servidor privado en puerto ${port}.`);if(!db.prepare('SELECT id FROM users LIMIT 1').get())console.log('Crea el propietario con npm run owner antes de iniciar sesión.');});
for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,()=>server.close(()=>{db.close();process.exit(0);}));
