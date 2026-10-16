import type {Server} from 'node:http';
import {readFile} from 'node:fs/promises';
import {existsSync,realpathSync} from 'node:fs';
import {resolve,isAbsolute} from 'node:path';
import type {RequestHandler} from 'express';
import {createServer,isFileLoadingAllowed,normalizePath} from 'vite';

// One HTTP server carries the API, frontend and HMR websocket through the private port.
export async function developmentFrontend(server:Server) {
 const publicOrigin=process.env.FOCUS_PUBLIC_ORIGIN;
 const publicUrl=publicOrigin?new URL(publicOrigin):null;
 const socketOrigin=publicUrl?`${publicUrl.protocol==='https:'?'wss:':'ws:'}//${publicUrl.host}`:undefined;
 const vite=await createServer({
  publicDir:false,
  server:{
   middlewareMode:true,
   cors:false,
   allowedHosts:publicUrl?[publicUrl.hostname]:[],
   hmr:{server,...(publicUrl?{protocol:publicUrl.protocol==='https:'?'wss':'ws',host:publicUrl.hostname,clientPort:Number(publicUrl.port||(publicUrl.protocol==='https:'?443:80))}:{})},
   fs:{strict:true,
    allow:['src','shared','node_modules','index.html'].map(path=>resolve(path)),
    deny:['.env','.env.*','*.{crt,pem,key}','*.{sqlite,sqlite-*,db,db-*,log}','**/.git/**','**/.data/**','**/server/**','**/scripts/**','**/tests/**','**/.codex/**','**/.agents/**','**/.devcontainer/**'],
   },
  },
  appType:'custom',
 });
 const appRoute=/^\/(?:dashboard|tasks|projects(?:\/[^/]+)?|journal(?:\/\d{4}-\d{2}-\d{2})?|progress|archive|settings)?\/?$/;
 const boundary:RequestHandler=(req,res,next)=>{
  let path:string;
  try{path=decodeURIComponent(new URL(req.originalUrl,'http://localhost').pathname);}catch{res.status(400).end();return;}
  if(appRoute.test(path)||path.startsWith('/@vite/')||path.startsWith('/@id/')){next();return;}
  // Check before Vite transforms ?import into a JS URL export. Both lexical and
  // resolved paths must be allowed, so a symlink cannot turn src into a DB outlet.
  const raw=path.slice(5);
  const file=normalizePath(path.startsWith('/@fs/')?resolve(isAbsolute(raw)?raw:'/'+raw):resolve('.'+path));
  if(path.includes('\\')||!isFileLoadingAllowed(vite.config,file)||(existsSync(file)&&!isFileLoadingAllowed(vite.config,normalizePath(realpathSync(file))))){
   res.status(403).type('text').send('Recurso no disponible');return;
  }
  next();
 };
 const html:RequestHandler=async(req,res,next)=>{
  if(req.method!=='GET'||!req.accepts('html')){next();return;}
  // Missing/denied asset requests must never turn into a successful SPA response.
  const path=new URL(req.originalUrl,'http://localhost').pathname;
  if(!appRoute.test(path)){
   res.status(404).type('text').send('Recurso no disponible');return;
  }
  try {
   const template=await readFile(resolve('index.html'),'utf8');
   res.status(200).type('html').send(await vite.transformIndexHtml(req.originalUrl,template));
  }catch(error){vite.ssrFixStacktrace(error as Error);next(error);}
 };
 return {frontend:[boundary,vite.middlewares as RequestHandler,html],socketOrigin,close:()=>vite.close()};
}
