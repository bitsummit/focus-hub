/** Resolve trusted server configuration, never identity or client-supplied proxy headers. */
export function resolveRuntime(env:NodeJS.ProcessEnv) {
 const port=Number(env.PORT||3000);
 if(!Number.isInteger(port)||port<1||port>65535)throw new Error('PORT debe ser un puerto entre 1 y 65535');
 const codespaces=env.CODESPACES==='true';
 let origin=env.FOCUS_PUBLIC_ORIGIN||undefined;
 if(codespaces&&!origin){
  const name=env.CODESPACE_NAME,domain=env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN;
  if(!name||!/^[a-z0-9-]+$/.test(name)||!domain||!/^[a-z0-9]+(?:[.-][a-z0-9]+)*\.[a-z]{2,}$/.test(domain))throw new Error('Faltan las variables oficiales de forwarding de Codespaces');
  origin=`https://${name}-${port}.${domain}`;
 }
 if(origin){
  let parsed:URL;try{parsed=new URL(origin);}catch{throw new Error('FOCUS_PUBLIC_ORIGIN no es una URL válida');}
  if(!['http:','https:'].includes(parsed.protocol)||parsed.username||parsed.password||parsed.search||parsed.hash||parsed.pathname!=='/'||(codespaces&&parsed.protocol!=='https:'))throw new Error('FOCUS_PUBLIC_ORIGIN debe ser un origen exacto, sin rutas ni credenciales; Codespaces requiere HTTPS');
  origin=parsed.origin;
 }
 // An HTTPS deployment must never downgrade its session cookies through a stale env flag.
 return {port,origin,secure:codespaces || !!origin?.startsWith('https:') || env.COOKIE_SECURE==='true'};
}

export function configureRuntime(env:NodeJS.ProcessEnv=process.env){
 const config=resolveRuntime(env);
 env.PORT=String(config.port);
 if(config.origin)env.FOCUS_PUBLIC_ORIGIN=config.origin;
 env.COOKIE_SECURE=String(config.secure);
 return config;
}
