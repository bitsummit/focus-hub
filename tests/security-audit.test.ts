import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,symlinkSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const {checkManifest,checkRule,snapshotSources}=await import(new URL('../scripts/security-audit.mjs',import.meta.url).href);
const manifest=JSON.parse(readFileSync(new URL('../.semgrep/rules.lock.json',import.meta.url),'utf8'));

test('local audit pins the public source and rejects duplicate or unsafe rule manifests',()=>{
 assert.equal(checkManifest(manifest),manifest);
 for(const changed of [{...manifest,upstream:'https://untrusted.example'}, {...manifest,commit:'moving-branch'}, {...manifest,rules:[manifest.rules[0],manifest.rules[0]]}, {...manifest,rules:[{...manifest.rules[0],path:'../../outside.yaml'}]}])assert.throws(()=>checkManifest(changed));
});
test('downloaded rule bytes must match the pinned digest before the scanner can use them',()=>{
 const bytes=Buffer.from('fictional public rule fixture');const rule={sha256:createHash('sha256').update(bytes).digest('hex')};
 checkRule(rule,bytes);assert.throws(()=>checkRule(rule,Buffer.from('changed fixture')),/checksum/);
});
test('audit snapshot preserves current text, includes tests and reports binary exclusions with private permissions',()=>{
 const dir=mkdtempSync(join(tmpdir(),'focus-audit-snapshot-')),source=join(dir,'checkout'),target=join(dir,'snapshot');
 try{
  mkdirSync(join(source,'tests'),{recursive:true});mkdirSync(target);
  writeFileSync(join(source,'tests','fixture.test.ts'),'export const currentWorkingTree = true;');writeFileSync(join(source,'font.woff2'),Buffer.from([0,1,2]));
  const result=snapshotSources(source,['tests/fixture.test.ts','font.woff2','deleted.ts'],target);
  assert.deepEqual(result.targets,['tests/fixture.test.ts']);assert.deepEqual(result.binary,['font.woff2']);
  assert.equal(readFileSync(join(target,'tests','fixture.test.ts'),'utf8'),'export const currentWorkingTree = true;');assert.equal(statSync(join(target,'tests','fixture.test.ts')).mode&0o777,0o600);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('audit snapshot refuses escaping paths and symlinks without modifying the outside source',()=>{
 const dir=mkdtempSync(join(tmpdir(),'focus-audit-boundary-')),source=join(dir,'checkout'),target=join(dir,'snapshot'),outside=join(dir,'outside.ts');
 try{
  mkdirSync(source);mkdirSync(target);writeFileSync(outside,'fictional outside fixture');symlinkSync(outside,join(source,'escape.ts'));
  for(const path of ['../outside.ts',outside,'escape.ts'])assert.throws(()=>snapshotSources(source,[path],target));
  symlinkSync(join(dir,'missing.ts'),join(source,'dangling.ts'));assert.throws(()=>snapshotSources(source,['dangling.ts'],target));
  writeFileSync(join(source,'nul.ts'),Buffer.from([0,1]));assert.throws(()=>snapshotSources(source,['nul.ts'],target),/NUL/);
  assert.equal(readFileSync(outside,'utf8'),'fictional outside fixture');
 }finally{rmSync(dir,{recursive:true,force:true});}
});
