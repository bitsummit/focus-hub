import {randomBytes,randomUUID,scryptSync,scrypt,timingSafeEqual,createHash} from 'node:crypto';
import type {Database} from './db.ts';
import type {Request,Response,NextFunction} from 'express';
import type {AuthContext,User} from '../shared/contracts.ts';
import {transaction} from './db.ts';
export interface AuthRequest extends Request {auth?:AuthContext; session?:{id_hash:string;csrf_token:string;user_id:string}}
export function publicUser(row:Record<string,unknown>):User {
 const {id,email,display_name,timezone,theme,preferred_task_view,week_start_day,created_at,language}=row;
 return {id,email,display_name,timezone,theme,preferred_task_view,week_start_day,created_at,language} as User;
}
// OWASP scrypt configuration N=2^15, r=8, p=3 (~32 MiB). Versioned for future upgrades.
const passwordCost={N:32768,r:8,p:3,maxmem:64*1024*1024};
function hashPassword(password:string){const salt=randomBytes(16).toString('hex');return `scrypt-v2:32768:8:3:${salt}:${scryptSync(password,salt,64,passwordCost).toString('hex')}`;}
function validatePassword(password:string){if(typeof password!=='string'||password.length<12||password.length>256)throw new Error('La contraseña debe tener entre 12 y 256 caracteres');}
function passwordParts(stored:string){
 const modern=/^scrypt-v2:32768:8:3:([a-f0-9]{32}):([a-f0-9]{128})$/.exec(stored);
 const legacy=/^([a-f0-9]{32}):([a-f0-9]{128})$/.exec(stored);
 const match=modern||legacy;
 return match?{salt:match[1],expected:Buffer.from(match[2],'hex'),cost:modern?passwordCost:{N:16384,r:8,p:1,maxmem:32*1024*1024}}:null;
}
export function verifyPassword(password:string,stored:string){const parts=passwordParts(stored);if(!parts)return false;return timingSafeEqual(scryptSync(password,parts.salt,64,parts.cost),parts.expected);}
let activePasswordChecks=0;
/** Online verification stays off the event loop and has a fixed memory/concurrency budget. */
export async function verifyPasswordAsync(password:string,stored:string):Promise<boolean>{
 const parts=passwordParts(stored);if(!parts)return false;
 if(activePasswordChecks>=2)throw Object.assign(new Error('El acceso está ocupado. Vuelve a intentarlo en unos segundos'),{status:503,code:'AUTH_BUSY'});
 activePasswordChecks++;
 try {
  const actual=await new Promise<Buffer>((resolve,reject)=>scrypt(password,parts.salt,64,parts.cost,(error,key)=>error?reject(error):resolve(key)));
  return timingSafeEqual(actual,parts.expected);
 }finally{activePasswordChecks--;}
}
export async function createOwner(db:Database,input:{email:string;password:string;display_name?:string}) {
 const email=input.email.trim().toLowerCase();
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254)throw new Error('Correo no válido');
 validatePassword(input.password);
 const id=randomUUID(), now=new Date().toISOString(), workspace=randomUUID();
 const hash=hashPassword(input.password);
 return transaction(db,async()=>{
  await db.run('INSERT INTO users(id,email,password_hash,display_name,created_at) VALUES($1,$2,$3,$4,$5)',[id,email,hash,(input.display_name||'Mi espacio').slice(0,120),now]);
  await db.run('INSERT INTO workspaces(id,name,owner_user_id,created_at) VALUES($1,$2,$3,$4)',[workspace,'Mi espacio de trabajo',id,now]);
  await db.run('INSERT INTO workspace_members(workspace_id,user_id,role,created_at) VALUES($1,$2,$3,$4)',[workspace,id,'owner',now]);
  return publicUser((await db.one('SELECT * FROM users WHERE id=$1',[id]))!);
 });
}
/** Local administration only. The user lock serializes rotation with session issuance. */
export async function changePassword(db:Database,input:{email:string;password:string}){
 validatePassword(input.password);
 const hash=hashPassword(input.password);
 await transaction(db,async()=>{
  const row=await db.one('SELECT id FROM users WHERE focus_ascii_fold(email)=focus_ascii_fold($1) FOR UPDATE',[input.email.trim()]);
  if(!row)throw new Error('No se encontró la cuenta indicada');
  await db.run('UPDATE users SET password_hash=$1 WHERE id=$2',[hash,row.id]);
  await db.run('DELETE FROM sessions WHERE user_id=$1',[row.id]);
 });
}
const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
export function sessionCookieName(){return process.env.CODESPACES==='true'||process.env.COOKIE_SECURE==='true'?'__Host-focus_session':'focus_session';}
export function clearSession(res:Response){
 const options={path:'/',httpOnly:true,sameSite:'strict' as const,secure:sessionCookieName().startsWith('__Host-')};
 res.clearCookie(sessionCookieName(),options);
 if(options.secure)res.clearCookie('focus_session',options);
}
export function cookieToken(req:Request){
 const name=sessionCookieName();
 const matches=(req.headers.cookie||'').split(';').map(x=>x.trim()).filter(x=>x.startsWith(name+'='));
 return matches.length===1?matches[0].slice(name.length+1):undefined;
}
export async function readSession(db:Database,req:Request){
 const token=cookieToken(req);if(!token||!/^[a-f0-9]{64}$/.test(token))return null;
 return await db.one('SELECT * FROM sessions WHERE id_hash=$1 AND expires_at>$2',[digest(token),new Date().toISOString()]) as {id_hash:string;user_id:string;csrf_token:string}|undefined;
}
export async function setSession(db:Database,res:Response,user_id:string){const token=randomBytes(32).toString('hex'),csrfToken=randomBytes(32).toString('hex'),now=Date.now();
 await db.run('DELETE FROM sessions WHERE expires_at<$1',[new Date(now).toISOString()]);
 await db.run('INSERT INTO sessions(id_hash,user_id,csrf_token,expires_at,created_at) VALUES($1,$2,$3,$4,$5)',[digest(token),user_id,csrfToken,new Date(now+7*86400000).toISOString(),new Date(now).toISOString()]);
 res.cookie(sessionCookieName(),token,{httpOnly:true,sameSite:'strict',secure:sessionCookieName().startsWith('__Host-'),maxAge:7*86400000,path:'/'});
 if(sessionCookieName().startsWith('__Host-'))res.clearCookie('focus_session',{path:'/',httpOnly:true,sameSite:'strict',secure:true});
 return csrfToken;
}
export function authMiddleware(db:Database){return async(req:AuthRequest,res:Response,next:NextFunction)=>{
 const session=await readSession(db,req);if(!session){res.status(401).json({code:'UNAUTHENTICATED',message:'Inicia sesión para continuar'});return;}
 const member=await db.one('SELECT workspace_id FROM workspace_members WHERE user_id=$1 AND role=$2',[session.user_id,'owner']);
 if(!member){res.status(403).json({code:'FORBIDDEN',message:'No tienes acceso a este espacio'});return;}
 req.auth={user_id:session.user_id,workspace_id:String(member.workspace_id)};req.session=session;
 if(!['GET','HEAD','OPTIONS'].includes(req.method)&&req.headers['x-csrf-token']!==session.csrf_token){res.status(403).json({code:'CSRF',message:'La sesión ha cambiado. Recarga la página e inténtalo de nuevo'});return;}
 next();
};}
export function sameOrigin(req:Request,res:Response,next:NextFunction){
 const origin=req.headers.origin;
 const reject=(reason:string)=>{
  if(process.env.CODESPACES==='true'||process.env.FOCUS_DEBUG_ORIGIN==='true'){
   const normalized=(value:string|undefined)=>{try{return value?new URL(value).origin:null;}catch{return 'invalid';}};
   const site=req.headers['sec-fetch-site'];
   console.warn('FOCUS_ORIGIN_REJECTED',JSON.stringify({reason,receivedOrigin:normalized(origin),expectedOrigin:normalized(process.env.FOCUS_PUBLIC_ORIGIN),host:normalized(req.headers.host?'http://'+req.headers.host:undefined),fetchSite:typeof site==='string'&&['none','same-origin','same-site','cross-site'].includes(site)?site:'unknown'}));
  }
  res.status(403).json({code:'ORIGIN',message:'Origen no permitido',reason});
 };
 if(req.headers['sec-fetch-site']==='cross-site'){reject('cross_site');return;}
 const localPort=req.socket.localPort;
 const allowedHosts=[`localhost:${localPort}`,`127.0.0.1:${localPort}`,`[::1]:${localPort}`];
 try{if(process.env.FOCUS_PUBLIC_ORIGIN)allowedHosts.push(new URL(process.env.FOCUS_PUBLIC_ORIGIN).host);}catch{reject('invalid_configuration');return;}
 if(!req.headers.host||!allowedHosts.includes(req.headers.host.toLowerCase())){reject('host_mismatch');return;}
 if(origin){try{const url=new URL(origin);const configured=process.env.FOCUS_PUBLIC_ORIGIN;const matches=configured?url.origin===new URL(configured).origin:url.host===req.headers.host;
   if(origin!==url.origin){reject('invalid_origin');return;}
   const port=String(Number(process.env.PORT||3000));
   const publicUrl=configured?new URL(configured):null;
   const mode=req.headers['sec-fetch-mode'],destination=req.headers['sec-fetch-dest'];
   // Codespaces rewrites Host to this exact internal endpoint; Origin may retain HTTPS.
   // This exception is not identity: login additionally requires a one-use challenge,
   // and every authenticated write still requires the server-issued session CSRF token.
   const internalHost=`localhost:${port}`;
   const internalOrigin=url.origin===`http://${internalHost}`||url.origin===`https://${internalHost}`;
   const rewritten=process.env.CODESPACES==='true'&&publicUrl?.protocol==='https:'&&internalOrigin&&origin===url.origin&&req.headers.host===internalHost&&req.headers['sec-fetch-site']==='same-origin'&&(mode===undefined||mode==='cors'||mode==='same-origin')&&(destination===undefined||destination==='empty');
   if((!matches&&!rewritten)||!['http:','https:'].includes(url.protocol)){reject('origin_mismatch');return;}}catch{reject('invalid_origin');return;}}
 next();
}
