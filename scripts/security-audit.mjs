import {createHash} from 'node:crypto';
import {execFileSync,spawnSync} from 'node:child_process';
import {closeSync,copyFileSync,chmodSync,existsSync,lstatSync,mkdirSync,mkdtempSync,openSync,readFileSync,realpathSync,rmSync,writeFileSync} from 'node:fs';
import {dirname,isAbsolute,join,relative,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
export function checkManifest(lock){
 if(lock.version!==1||!/^\d+\.\d+\.\d+$/.test(lock.semgrepVersion)||lock.upstream!=='https://github.com/semgrep/semgrep-rules'||! /^[a-f0-9]{40}$/.test(lock.commit)||!Array.isArray(lock.rules)||!lock.rules.length)throw Error('Invalid Semgrep rule manifest.');
 const ids=new Set();
 for(const rule of lock.rules){
  if(!/^[a-zA-Z0-9_-]+$/.test(rule.id)||ids.has(rule.id)||! /^[a-f0-9]{64}$/.test(rule.sha256)||! /^[a-zA-Z0-9_/-]+\.ya?ml$/.test(rule.path)||rule.path.split('/').includes('..')||isAbsolute(rule.path))throw Error('Invalid or duplicate Semgrep rule.');
  ids.add(rule.id);
 }
 return lock;
}
export function checkRule(rule,bytes){if(digest(bytes)!==rule.sha256)throw Error('Public rule checksum mismatch; refusing to scan.');}
export function snapshotSources(source,files,destination){
 const targets=[],binary=[];
 for(const name of [...new Set(files)].sort()){
  const path=resolve(source,name),inside=relative(source,path);
  if(isAbsolute(name)||inside.startsWith('..')||isAbsolute(inside))throw Error('Source path escapes the checkout.');
  let stat;try{stat=lstatSync(path);}catch(error){if(error.code==='ENOENT')continue;throw error;} // Deleted tracked files.
  if(!stat.isFile()||stat.isSymbolicLink()||realpathSync(path)!==path)throw Error('Source must be a regular file without symlink components.');
  if(readFileSync(path).includes(0)){
   if(/\.(?:[cm]?[jt]sx?|sql|sh|json|ya?ml|toml|html|css)$/.test(name))throw Error('NUL bytes in a source/config file; refusing to silently exclude it.');
   binary.push(name);continue;
  }
  const target=join(destination,inside);mkdirSync(dirname(target),{recursive:true,mode:0o700});copyFileSync(path,target);chmodSync(target,0o600);targets.push(inside);
 }
 if(!targets.length)throw Error('No text sources selected.');
 return {targets,binary};
}
function privateDirectory(path){
 mkdirSync(path,{recursive:true,mode:0o700});const stat=lstatSync(path);
 if(!stat.isDirectory()||stat.isSymbolicLink()||realpathSync(path)!==path||(stat.mode&0o077)||(process.getuid&&stat.uid!==process.getuid()))throw Error('Audit cache must be a private directory owned by this user.');
}
export function audit(){
 const lock=checkManifest(JSON.parse(readFileSync(join(root,'.semgrep/rules.lock.json'),'utf8')));
 const cache=join(realpathSync(tmpdir()),`focus-semgrep-${process.getuid?.()??'local'}`);privateDirectory(cache);
 const work=mkdtempSync(join(realpathSync(tmpdir()),'focus-semgrep-audit-')),source=join(work,'source');mkdirSync(source,{mode:0o700});
 const report=join(work,'report.json'),log=join(work,'engine.log');
 // Only pass tooling/proxy settings, never application database/auth credentials.
 const env=Object.fromEntries(['PATH','LANG','LC_ALL','HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','NO_PROXY','http_proxy','https_proxy','all_proxy','no_proxy','SSL_CERT_FILE','SSL_CERT_DIR','REQUESTS_CA_BUNDLE'].filter(key=>process.env[key]!==undefined).map(key=>[key,process.env[key]]));
 Object.assign(env,{UV_CACHE_DIR:join(cache,'uv-cache'),UV_TOOL_DIR:join(cache,'uv-tools'),UV_TOOL_BIN_DIR:join(cache,'bin'),SEMGREP_SETTINGS_FILE:join(work,'settings.yml'),SEMGREP_LOG_FILE:log,SEMGREP_SEND_METRICS:'off',SEMGREP_ENABLE_VERSION_CHECK:'0'});
 try{
  const configs=[];
  for(const rule of lock.rules){
   const path=join(cache,rule.sha256+'.yaml');
   if(!existsSync(path)){
    const url=`https://raw.githubusercontent.com/semgrep/semgrep-rules/${lock.commit}/${rule.path}`;
    const bytes=execFileSync('curl',['--fail','--silent','--show-error','--proto','=https','--max-time','30',url],{env,maxBuffer:2*1024*1024});
    checkRule(rule,bytes);writeFileSync(path,bytes,{flag:'wx',mode:0o600});
   }else{if(lstatSync(path).isSymbolicLink()||!lstatSync(path).isFile())throw Error('Rule cache must contain regular files.');checkRule(rule,readFileSync(path));}
   configs.push('--config',path);
  }
  const names=execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean);
  const selected=snapshotSources(root,names,source);
  const args=['--from',`semgrep==${lock.semgrepVersion}`,'semgrep','scan','--oss-only','--metrics=off','--disable-version-check','--disable-nosem','--no-rewrite-rule-ids','--no-git-ignore','--strict','--error','--json','--output',report,...configs,'--',...selected.targets];
  // Explicit file targets include tests/scripts; built-in directory ignores cannot hide them.
  const fd=openSync(log,'a',0o600);let child;
  try{child=spawnSync('uvx',args,{cwd:source,env,stdio:['ignore',fd,fd],timeout:180000});}finally{closeSync(fd);}
  if(child.error||child.signal||!existsSync(report))throw Error('Semgrep did not finish. Check the private engine log.');
  chmodSync(report,0o600);const result=JSON.parse(readFileSync(report,'utf8'));
  if(result.version!==lock.semgrepVersion)throw Error('Unexpected Semgrep version in the report.');
  const summary={semgrepVersion:lock.semgrepVersion,rulesCommit:lock.commit,rules:lock.rules.length,selectedFiles:selected.targets.length,scannedFiles:result.paths?.scanned?.length??0,binaryFilesExcluded:selected.binary,findings:result.results?.length??0,errors:result.errors?.length??0,exitCode:child.status};
  const gitCommit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
  const sourceHashes=Object.fromEntries(selected.targets.map(path=>[path,digest(readFileSync(join(source,path)))]));
  writeFileSync(join(work,'scope.json'),JSON.stringify({...summary,gitCommit,manifestSha256:digest(readFileSync(join(root,'.semgrep/rules.lock.json'))),files:selected.targets,sourceHashes},null,2)+'\n',{mode:0o600});
  console.log(JSON.stringify(summary,null,2));console.log(`Private report and log: ${work}`);
  if(![0,1].includes(child.status)||summary.errors||summary.scannedFiles!==summary.selectedFiles)throw Error('Audit incomplete: engine errors, excluded text files or unexpected exit status.');
  return child.status;
 }catch(error){console.error(`${error.message} Private audit directory: ${work}`);return 2;}
 finally{rmSync(source,{recursive:true,force:true});}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(process.argv.length!==2){console.error('Usage: node scripts/security-audit.mjs');process.exitCode=2;}
 else{try{process.exitCode=audit();}catch(error){console.error(error.message);process.exitCode=2;}}
}
