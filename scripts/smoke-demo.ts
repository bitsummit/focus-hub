import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
// Local readiness check: credentials stay inside the process and never enter logs.
const access=JSON.parse(readFileSync('.data/demo-access.json','utf8'));
const port=Number(process.env.PORT||3000);
const base=`http://127.0.0.1:${port}`;
const origin=process.env.FOCUS_PUBLIC_ORIGIN || (process.env.CODESPACES==='true' && process.env.CODESPACE_NAME && process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN ? `https://${process.env.CODESPACE_NAME}-${port}.${process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}` : base);
assert.equal((await fetch(base+'/api/state')).status,401,'La API debe exigir autenticación');
const login=await fetch(base+'/api/session',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify({email:access.email,password:access.password})});
assert.equal(login.status,200,'El acceso a la demo debe funcionar');
const session=await login.json();const cookie=login.headers.get('set-cookie')!.split(';')[0];
const response=await fetch(base+'/api/state',{headers:{Cookie:cookie}});
assert.equal(response.status,200);const state=await response.json();
assert.ok(state.tasks.length>0&&state.projects.length>0&&state.journals.length>0,'La demo debe conservar sus registros');
assert.ok(state.blocks.some((b:{task_id:string|null})=>b.task_id&&state.tasks.some((t:{id:string})=>t.id===b.task_id)),'El diario debe resolver tareas canónicas');
assert.equal(JSON.stringify(state).includes('password_hash'),false,'El snapshot no debe exponer credenciales');
const logout=await fetch(base+'/api/session',{method:'DELETE',headers:{Cookie:cookie,Origin:origin,'X-CSRF-Token':session.csrfToken}});assert.equal(logout.status,200);
console.log('Demo verificada: autenticación, persistencia de registros y referencias canónicas del diario correctas.');
