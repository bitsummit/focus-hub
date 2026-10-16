import type {Server} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import type {RequestHandler} from 'express';
import {createServer} from 'vite';

// One HTTP server carries the API, frontend and HMR websocket through the private port.
export async function developmentFrontend(server:Server) {
 const publicOrigin=process.env.FOCUS_PUBLIC_ORIGIN;
 const publicUrl=publicOrigin?new URL(publicOrigin):null;
 const socketOrigin=publicUrl?`${publicUrl.protocol==='https:'?'wss:':'ws:'}//${publicUrl.host}`:undefined;
 const vite=await createServer({
  server:{
   middlewareMode:true,
   cors:false,
   allowedHosts:publicUrl?[publicUrl.hostname]:[],
   hmr:{server,...(publicUrl?{protocol:publicUrl.protocol==='https:'?'wss':'ws',host:publicUrl.hostname,clientPort:Number(publicUrl.port||(publicUrl.protocol==='https:'?443:80))}:{})},
   fs:{strict:true,deny:['.env','.env.*','*.{crt,pem,key}','**/.git/**','**/.data/**','**/server/**','**/scripts/**','**/tests/**','.codex/**','.agents/**']},
  },
  appType:'custom',
 });
 const html:RequestHandler=async(req,res,next)=>{
  if(req.method!=='GET'||!req.accepts('html')){next();return;}
  try {
   const template=await readFile(resolve('index.html'),'utf8');
   res.status(200).type('html').send(await vite.transformIndexHtml(req.originalUrl,template));
  }catch(error){vite.ssrFixStacktrace(error as Error);next(error);}
 };
 return {frontend:[vite.middlewares as RequestHandler,html],socketOrigin,close:()=>vite.close()};
}
