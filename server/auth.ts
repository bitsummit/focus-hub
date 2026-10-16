import {randomBytes,randomUUID,scryptSync,timingSafeEqual,createHash} from 'node:crypto';
import type {DatabaseSync} from 'node:sqlite';
import type {Request,Response,NextFunction} from 'express';
import type {AuthContext,User} from '../shared/contracts.ts';
import {transaction} from './db.ts';
export interface AuthRequest extends Request {auth?:AuthContext; session?:{id_hash:string;csrf_token:string;user_id:string}}
export function publicUser(row:Record<string,unknown>):User {const {password_hash,...safe}=row; return safe as unknown as User;}
function hashPassword(password:string){const salt=randomBytes(16).toString('hex');return `${salt}:${scryptSync(password,salt,64).toString('hex')}`;}
export function verifyPassword(password:string,stored:string){const [salt,hash]=stored.split(':');const expected=Buffer.from(hash,'hex');const actual=scryptSync(password,salt,64);return actual.length===expected.length&&timingSafeEqual(actual,expected);}
export function createOwner(db:DatabaseSync,input:{email:string;password:string;display_name?:string}) {
 const email=input.email.trim().toLowerCase();
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254)throw new Error('Correo no válido');
 if(input.password.length<12||input.password.length>256)throw new Error('La contraseña debe tener entre 12 y 256 caracteres');
 const id=randomUUID(), now=new Date().toISOString(), workspace=randomUUID();
 transaction(db,()=>{
 db.prepare('INSERT INTO users(id,email,password_hash,display_name,created_at) VALUES(?,?,?,?,?)').run(id,email,hashPassword(input.password),(input.display_name||'Mi espacio').slice(0,120),now);
 db.prepare('INSERT INTO workspaces(id,name,owner_user_id,created_at) VALUES(?,?,?,?)').run(workspace,'Mi espacio de trabajo',id,now);
 db.prepare('INSERT INTO workspace_members(workspace_id,user_id,role,created_at) VALUES(?,?,?,?)').run(workspace,id,'owner',now);
 });
 return publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(id)!);
}
const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
export function cookieToken(req:Request){const match=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('focus_session='));return match?.slice('focus_session='.length);}
export function readSession(db:DatabaseSync,req:Request){const token=cookieToken(req);if(!token||!/^[a-f0-9]{64}$/.test(token))return null;return db.prepare('SELECT * FROM sessions WHERE id_hash=? AND expires_at>?').get(digest(token),new Date().toISOString()) as {id_hash:string;user_id:string;csrf_token:string}|undefined;}
export function setSession(db:DatabaseSync,res:Response,user_id:string){const token=randomBytes(32).toString('hex'),csrfToken=randomBytes(32).toString('hex'),now=Date.now();
 db.prepare('DELETE FROM sessions WHERE expires_at<?').run(new Date(now).toISOString());
 db.prepare('INSERT INTO sessions(id_hash,user_id,csrf_token,expires_at,created_at) VALUES(?,?,?,?,?)').run(digest(token),user_id,csrfToken,new Date(now+7*86400000).toISOString(),new Date(now).toISOString());
 res.cookie('focus_session',token,{httpOnly:true,sameSite:'strict',secure:process.env.COOKIE_SECURE==='true',maxAge:7*86400000,path:'/'}); return csrfToken;
}
export function authMiddleware(db:DatabaseSync){return(req:AuthRequest,res:Response,next:NextFunction)=>{
 const session=readSession(db,req);if(!session){res.status(401).json({code:'UNAUTHENTICATED',message:'Inicia sesión para continuar'});return;}
 const member=db.prepare('SELECT workspace_id FROM workspace_members WHERE user_id=? AND role=?').get(session.user_id,'owner') as {workspace_id:string}|undefined;
 if(!member){res.status(403).json({code:'FORBIDDEN',message:'No tienes acceso a este espacio'});return;}
 req.auth={user_id:session.user_id,workspace_id:member.workspace_id};req.session=session;
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
 if(origin){try{const url=new URL(origin);const configured=process.env.FOCUS_PUBLIC_ORIGIN;const matches=configured?url.origin===new URL(configured).origin:url.host===req.headers.host;
   const port=String(Number(process.env.PORT||3000));
   const publicUrl=configured?new URL(configured):null;
   const mode=req.headers['sec-fetch-mode'],destination=req.headers['sec-fetch-dest'];
   // Codespaces was observed rewriting both Host and Origin to this exact internal endpoint.
   // This exception is not identity: login additionally requires a one-use challenge,
   // and every authenticated write still requires the server-issued session CSRF token.
   const rewritten=process.env.CODESPACES==='true'&&publicUrl?.protocol==='https:'&&url.origin===`http://localhost:${port}`&&origin===url.origin&&req.headers.host===`localhost:${port}`&&req.headers['sec-fetch-site']==='same-origin'&&(mode===undefined||mode==='cors'||mode==='same-origin')&&(destination===undefined||destination==='empty');
   if((!matches&&!rewritten)||!['http:','https:'].includes(url.protocol)){reject('origin_mismatch');return;}}catch{reject('invalid_origin');return;}}
 next();
}
