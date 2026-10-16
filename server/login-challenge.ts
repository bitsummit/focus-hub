import {randomBytes,createHash,timingSafeEqual} from 'node:crypto';
import type {Request,Response} from 'express';

/** A one-use, ten-minute pre-login CSRF challenge. Never persisted or logged. */
export function loginChallenges(){
 const pending=new Map<string,number>();
 const secure=process.env.CODESPACES==='true'||process.env.COOKIE_SECURE==='true';
 const name=secure?'__Host-focus_login_csrf':'focus_login_csrf';
 const options={httpOnly:true,secure,sameSite:'strict' as const,path:'/'};
 const hash=(token:string)=>createHash('sha256').update(token).digest('hex');
 function prune(){const now=Date.now();for(const [key,expires]of pending)if(expires<=now)pending.delete(key);}
 return {
  issue(_req:Request,res:Response){
   prune();while(pending.size>=1000)pending.delete(pending.keys().next().value!);
   const token=randomBytes(32).toString('hex');pending.set(hash(token),Date.now()+10*60*1000);
   res.cookie(name,token,{...options,maxAge:10*60*1000});res.set('Cache-Control','no-store').json({loginToken:token});
  },
  validate(req:Request):boolean{
   prune();const token=req.headers['x-login-csrf'];
   const cookies=(req.headers.cookie||'').split(';').map(s=>s.trim()).filter(s=>s.startsWith(name+'='));
   if(typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token)||cookies.length!==1)return false;
   const cookie=cookies[0].slice(name.length+1);if(!/^[a-f0-9]{64}$/.test(cookie)||!timingSafeEqual(Buffer.from(token,'hex'),Buffer.from(cookie,'hex')))return false;
   const key=hash(token),expiry=pending.get(key);if(!expiry||expiry<=Date.now())return false;
   pending.delete(key);return true;
  },
  clear(res:Response){res.clearCookie(name,options);}
 };
}
