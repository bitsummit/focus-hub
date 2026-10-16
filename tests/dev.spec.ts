import {test,expect,type Page} from '@playwright/test';
import {spawn,execFileSync,type ChildProcess} from 'node:child_process';
import {createServer as createHTTP,request as requestHTTP,type Server} from 'node:http';
import {createServer as createHTTPS} from 'node:https';
import {connect,type Socket} from 'node:net';
import {once} from 'node:events';
import {mkdtempSync,readFileSync,writeFileSync,rmSync,mkdirSync,symlinkSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {openDatabase} from '../server/db.ts';
import {createOwner} from '../server/auth.ts';

test.use({ignoreHTTPSErrors:true});

async function unusedPort(){
 const server=createHTTP().listen(0,'127.0.0.1');await once(server,'listening');
 const address=server.address();if(!address||typeof address==='string')throw Error('No fixture port');
 await new Promise<void>((done,reject)=>server.close(error=>error?reject(error):done()));return address.port;
}
async function stop(child:ChildProcess){
 if(child.exitCode!==null)return;
 const exited=once(child,'exit');child.kill('SIGTERM');
 const timer=setTimeout(()=>child.kill('SIGKILL'),5000);
 try{await exited;}finally{clearTimeout(timer);}
}
async function exercise(page:Page,origin:string,cssURL:string,cssFile:string){
 const connected:string[]=[];
 page.on('websocket',socket=>socket.on('framereceived',frame=>connected.push(String(frame.payload))));
 await page.goto(origin);
 await expect.poll(()=>connected.some(frame=>frame.includes('"type":"connected"')),{message:'Vite HMR WebSocket connects on the application origin',timeout:15000}).toBeTruthy();
 await page.getByLabel(/correo/i).fill('dev-browser@example.test');
 await page.getByLabel(/contraseña/i).fill('Fictional-Dev-Browser-2026!');
 await page.getByRole('button',{name:/entrar en mi espacio/i}).click();
 const capture=page.getByRole('textbox',{name:/captura rápida/i});
 await capture.fill('Captura persistente desarrollo QA');await capture.press('Enter');await expect(capture).toHaveValue('');
 await page.goto(origin+'/tasks');await expect(page.getByRole('button',{name:'Captura persistente desarrollo QA',exact:true})).toBeVisible();
 await page.reload();await expect(page.getByRole('button',{name:'Captura persistente desarrollo QA',exact:true})).toBeVisible();
 let navigations=0;page.on('framenavigated',frame=>{if(frame===page.mainFrame())navigations++;});
 await page.evaluate(async path=>{await import(/* @vite-ignore */path);},cssURL);
 const value=()=>page.evaluate(()=>getComputedStyle(document.body).getPropertyValue('--focus-dev-qa').trim());
 await expect.poll(value).toBe('before');
 writeFileSync(cssFile,'body { --focus-dev-qa: after; }\n');
 await expect.poll(value,{message:'CSS changes are applied over HMR without navigation',timeout:15000}).toBe('after');
 expect(navigations).toBe(0);
}

for(const proxyMode of [false,true]){
 test(`development server: ${proxyMode?'HTTPS Codespaces-style proxy':'direct localhost'} supports authenticated persistence, CSS HMR and private-file isolation`,async({page})=>{
  test.setTimeout(60000);
  const root=resolve('.'),dir=mkdtempSync(join(tmpdir(),'focus-dev-browser-'));
  const name=`__focus_dev_qa_${randomUUID().replaceAll('-','')}`;
  const cssFile=join(root,'src',name+'.css');
  const markerFile=join(root,'.data',name+'.txt'),marker='Fictional nonsecret dev fixture '+name;
  const privateFiles=[join(root,name+'.sqlite'),join(root,name+'.txt'),join(root,'src',name+'.sqlite'),join(root,'src','.env.'+name)];
  const linkedFile=join(root,'src',name+'_link.txt');
  const dbFile=join(dir,'fixture.sqlite'),db=openDatabase(dbFile);
  createOwner(db,{email:'dev-browser@example.test',password:'Fictional-Dev-Browser-2026!',display_name:'Desarrollo ficticio QA'});db.close();
  mkdirSync(join(root,'.data'),{recursive:true,mode:0o700});writeFileSync(markerFile,marker,{mode:0o600});
  writeFileSync(cssFile,'body { --focus-dev-qa: before; }\n');
  for(const file of privateFiles)writeFileSync(file,marker,{mode:0o600});
  symlinkSync(markerFile,linkedFile);
  const backendPort=await unusedPort(),proxyPort=proxyMode?await unusedPort():undefined;
  const origin=proxyMode?`https://127.0.0.1:${proxyPort}`:`http://127.0.0.1:${backendPort}`;
  const internalHost=`localhost:${backendPort}`;
  let proxy:Server|undefined;const sockets=new Set<Socket>();let output='';
  let child:ChildProcess|undefined;
  try{
   if(proxyMode){
    const key=join(dir,'key.pem'),cert=join(dir,'cert.pem');
    execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost,IP:127.0.0.1'],{stdio:'ignore'});
    proxy=createHTTPS({key:readFileSync(key),cert:readFileSync(cert)},(req,res)=>{
     const headers={...req.headers,host:internalHost};if(headers.origin)headers.origin=`http://${internalHost}`;
     const upstream=requestHTTP({host:'127.0.0.1',port:backendPort,path:req.url,method:req.method,headers},response=>{res.writeHead(response.statusCode!,response.headers);response.pipe(res);});
     upstream.on('error',()=>{res.statusCode=502;res.end();});req.pipe(upstream);
    });
    proxy.on('upgrade',(req,socket,head)=>{
     const upstream=connect(backendPort,'127.0.0.1');sockets.add(upstream);sockets.add(socket as Socket);
     upstream.on('error',()=>socket.destroy());socket.on('error',()=>upstream.destroy());
     socket.on('close',()=>{upstream.destroy();sockets.delete(socket as Socket);});upstream.on('close',()=>sockets.delete(upstream));
     upstream.on('connect',()=>{
      const headers={...req.headers,host:internalHost};if(headers.origin)headers.origin=`http://${internalHost}`;
      upstream.write(`${req.method} ${req.url} HTTP/1.1\r\n${Object.entries(headers).map(([key,value])=>`${key}: ${Array.isArray(value)?value.join(', '):value}`).join('\r\n')}\r\n\r\n`);
      if(head.length)upstream.write(head);socket.pipe(upstream).pipe(socket);
     });
    });
    proxy.listen(proxyPort,'127.0.0.1');await once(proxy,'listening');
   }
   const env:NodeJS.ProcessEnv={...process.env,FOCUS_DB:dbFile,PORT:String(backendPort),CODESPACES:String(proxyMode),COOKIE_SECURE:String(proxyMode)};
   if(proxyMode){env.FOCUS_DEV='true';env.FOCUS_PUBLIC_ORIGIN=origin;}
   else{delete env.FOCUS_DEV;delete env.FOCUS_PUBLIC_ORIGIN;}
   child=spawn(process.execPath,['--import','tsx',proxyMode?'server/index.ts':'server/dev.ts'],{cwd:root,env,stdio:['ignore','pipe','pipe']});
   child.stdout?.on('data',chunk=>{output+=String(chunk);});child.stderr?.on('data',chunk=>{output+=String(chunk);});
   await expect.poll(async()=>{try{return(await fetch(`http://127.0.0.1:${backendPort}/api/health`)).status;}catch{return 0;}},{message:'Isolated development backend starts',timeout:20000}).toBe(200);
   // These requests are anonymous: Vite must enforce the filesystem boundary itself.
   const privatePaths=['/.data/demo-access.json','/.data/'+name+'.txt','/@fs/'+markerFile,
    '/src/'+name+'_link.txt','/@fs/'+linkedFile,'/.%64ata/'+name+'.txt','/src/..%2f.data/'+name+'.txt',
    '/.codex/config.toml','/.devcontainer/devcontainer.json','/server/auth.ts','/AGENTS.md',
    ...privateFiles.flatMap(file=>['/'+file.slice(root.length+1),'/@fs/'+file])];
   for(const path of privatePaths.flatMap(path=>[path,path+'?raw',path+'?import'])){
    const result=await page.request.get(origin+path,{ignoreHTTPSErrors:proxyMode});
    expect([403,404],`private path is denied: ${path}`).toContain(result.status());
    expect(await result.text()).not.toContain(marker);
   }
   await exercise(page,origin,'/src/'+name+'.css',cssFile);
  }catch(error){throw new Error(`${error instanceof Error?error.message:String(error)}\nDevelopment server output:\n${output}`,{cause:error});}
  finally{
   await page.goto('about:blank');for(const socket of sockets)socket.destroy();
   if(child)await stop(child);
   if(proxy){proxy.closeAllConnections();await new Promise<void>(done=>proxy!.close(()=>done()));}
   rmSync(cssFile,{force:true});rmSync(linkedFile,{force:true});rmSync(markerFile,{force:true});for(const file of privateFiles)rmSync(file,{force:true});rmSync(dir,{recursive:true,force:true});
  }
 });
}
