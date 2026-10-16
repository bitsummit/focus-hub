import express,{type Request,type Response,type NextFunction} from 'express';
import type {DatabaseSync} from 'node:sqlite';
import {resolve} from 'node:path';
import {existsSync} from 'node:fs';
import {authMiddleware,publicUser,readSession,sameOrigin,setSession,clearSession,verifyPasswordAsync,type AuthRequest} from './auth.ts';
import {Domain} from './domain.ts';
import {loginChallenges} from './login-challenge.ts';
import {loginLimiter} from './login-limiter.ts';
import {transaction} from './db.ts';
export function createApp(db:DatabaseSync,options:{frontend?:express.RequestHandler[];developmentSocketOrigin?:string}={}) {
 const app=express(); app.disable('x-powered-by');
 app.use((_req,res,next)=>{res.set({'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY','Cache-Control':'no-store','Content-Security-Policy':`default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'${options.developmentSocketOrigin?' '+options.developmentSocketOrigin:''}; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`});next();});
 app.use((_req,res,next)=>{
  res.set('Permissions-Policy','camera=(), microphone=(), geolocation=(), payment=()');
  if(process.env.COOKIE_SECURE==='true'||process.env.CODESPACES==='true')res.set('Strict-Transport-Security','max-age=15552000');
  next();
 });
 app.use('/api',sameOrigin,express.json({limit:'512kb'}));
 app.get('/api/health',(_req,res)=>res.json({status:'ok'}));
 const challenge=loginChallenges();
 app.get('/api/session/challenge',challenge.issue);
 const attempts=loginLimiter();
 app.post('/api/session',async(req,res)=>{
  if(!req.is('application/json')||!challenge.validate(req)){res.status(403).json({code:'LOGIN_CSRF',message:'Actualiza el acceso e inténtalo de nuevo'});return;}
  const {email,password}=req.body||{};
  if(typeof email!=='string'||typeof password!=='string'||email.length>254||password.length>256){res.status(400).json({code:'VALIDATION',message:'Introduce tu correo y contraseña'});return;}
  const wait=attempts.consume(email,req.ip||'local');
  if(wait){res.set('Retry-After',String(wait)).status(429).json({code:'RATE_LIMIT',message:'Demasiados intentos. Espera antes de volver a intentarlo'});return;}
  const row=db.prepare('SELECT * FROM users WHERE email=? COLLATE NOCASE').get(email.trim());
  // Always run scrypt so unknown accounts do not have a cheap timing path.
  const valid=await verifyPasswordAsync(password,row?String(row.password_hash):'scrypt-v2:32768:8:3:'+ '00'.repeat(16)+':'+ '00'.repeat(64));
  if(!row||!valid){res.status(401).json({code:'CREDENTIALS',message:'Correo o contraseña incorrectos'});return;}
  // Rotation can happen while the asynchronous KDF runs. Never issue a new
  // session for an old hash after the administrator has revoked that credential.
  const csrfToken=transaction(db,()=>{
   const current=db.prepare('SELECT password_hash FROM users WHERE id=?').get(String(row.id));
   return current?.password_hash===row.password_hash?setSession(db,res,String(row.id)):null;
  });
  if(!csrfToken){res.status(401).json({code:'CREDENTIALS',message:'Correo o contraseña incorrectos'});return;}
  challenge.clear(res);res.json({user:publicUser(row),csrfToken});
 });
 app.get('/api/session',(req,res)=>{const session=readSession(db,req);if(!session){res.status(401).json({code:'UNAUTHENTICATED',message:'Inicia sesión para continuar'});return;}const row=db.prepare('SELECT * FROM users WHERE id=?').get(session.user_id);if(!row){res.status(401).end();return;}res.json({user:publicUser(row),csrfToken:session.csrf_token});});
 app.use('/api',authMiddleware(db));
 app.delete('/api/session',(req:AuthRequest,res)=>{db.prepare('DELETE FROM sessions WHERE id_hash=?').run(req.session!.id_hash);clearSession(res);res.json({ok:true});});
 const domain=(req:Request)=>new Domain(db,(req as AuthRequest).auth!);
 app.get('/api/state',(req,res)=>res.json(domain(req).snapshot()));
 app.post('/api/tasks',(req,res)=>{const d=domain(req);d.capture(req.body);res.status(201).json(d.snapshot());});
 app.patch('/api/tasks/:id',(req,res)=>{const d=domain(req);d.updateTask(String(req.params.id),req.body);res.json(d.snapshot());});
 app.delete('/api/tasks/:id',(req,res)=>{const d=domain(req);d.deleteTask(String(req.params.id));res.json(d.snapshot());});
 app.get('/api/tasks/:id/events',(req,res)=>{const s=domain(req).snapshot();if(!s.tasks.some(t=>t.id===req.params.id)){res.status(404).json({code:'NOT_FOUND',message:'Tarea no encontrada'});return;}res.json(s.events.filter(e=>e.task_id===req.params.id));});
 for(const kind of ['projects','goals','milestones'] as const){
  app.post('/api/'+kind,(req,res)=>{const d=domain(req);d.createEntity(kind,req.body);res.status(201).json(d.snapshot());});
  app.patch('/api/'+kind+'/:id',(req,res)=>{const d=domain(req);d.updateEntity(kind,String(req.params.id),req.body);res.json(d.snapshot());});
 }
 app.post('/api/journals/:date/blocks',(req,res)=>{const d=domain(req);d.appendBlock(String(req.params.date),req.body);res.status(201).json(d.snapshot());});
 app.get('/api/journals/:date',(req,res)=>{const s=domain(req).snapshot();const entry=s.journals.find(j=>j.entry_date===req.params.date);res.json({entry:entry||null,blocks:entry?s.blocks.filter(b=>b.journal_entry_id===entry.id):[]});});
 app.patch('/api/blocks/:id',(req,res)=>{const d=domain(req);d.updateBlock(String(req.params.id),req.body);res.json(d.snapshot());});
 app.delete('/api/blocks/:id',(req,res)=>{const d=domain(req);d.deleteBlock(String(req.params.id),req.body?.revision);res.json(d.snapshot());});
 app.put('/api/focus/:type/:date',(req,res)=>{const d=domain(req);d.setFocus(String(req.params.type),String(req.params.date),req.body?.task_ids);res.json(d.snapshot());});
 app.patch('/api/preferences',(req,res)=>{const d=domain(req);d.preferences(req.body);res.json(d.snapshot());});
 app.get('/api/analytics',(req,res)=>res.json(domain(req).analytics(String(req.query.start||''),String(req.query.end||''))));
 app.get('/api/export',(req,res)=>{const d=domain(req);if(req.query.format==='csv'){res.set({'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="focus-hub-tasks.csv"'}).send(d.exportCSV());}else{res.set({'Content-Type':'application/json; charset=utf-8','Content-Disposition':'attachment; filename="focus-hub.json"'}).send(JSON.stringify(d.exportJSON(),null,2));}});
 app.use('/api',(_req,res)=>res.status(404).json({code:'NOT_FOUND',message:'Ruta no encontrada'}));
 if(options.frontend)app.use(...options.frontend);
 else if(existsSync(resolve('dist/index.html'))){app.use(express.static(resolve('dist'),{index:false}));app.get('/{*path}',(_req,res)=>res.sendFile(resolve('dist/index.html')));}
 app.use((error:unknown,_req:Request,res:Response,_next:NextFunction)=>{
  const e=error as {status?:number;code?:string;message?:string;issues?:unknown;type?:string};
  const status=e.status&&e.status>=400&&e.status<600?e.status:e.issues?400:500;
  if(status===500)console.error('FOCUS_INTERNAL_ERROR');
  if(e.code==='AUTH_BUSY')res.set('Retry-After','2');
  if(e.type==='entity.parse.failed'){res.status(400).json({code:'INVALID_JSON',message:'El cuerpo de la solicitud no contiene JSON válido'});return;}
  res.status(status).json({code:e.code|| (status===500?'INTERNAL':'VALIDATION'),message:status===500?'No se pudo completar la operación':e.message||'Datos no válidos'});
 });return app;
}
