import en from './locales/en.json';
import type {Language} from '../shared/contracts';

// SQLite is authoritative after authentication. This presentation-only hint lets
// the login screen remember the language without caching account data.
const cacheKey='focus-hub.language';
let active:Language='es';
try { if(typeof localStorage!=='undefined'&&localStorage.getItem(cacheKey)==='en')active='en'; } catch {}
const listeners=new Set<()=>void>();
export const getLanguage=():Language=>active;
export const locale=getLanguage;
export function subscribeLanguage(listener:()=>void){listeners.add(listener);return()=>{listeners.delete(listener);};}
export function setLanguage(language:Language){
 if(language!=='es'&&language!=='en')return;
 const changed=active!==language;active=language;
 if(typeof document!=='undefined')document.documentElement.lang=language;
 try{if(typeof localStorage!=='undefined')localStorage.setItem(cacheKey,language);}catch{}
 if(changed)for(const listener of listeners)listener();
}
if(typeof document!=='undefined')document.documentElement.lang=active;
const english:Record<string,string>=en;
/** Translate interface copy only. Never pass task titles, notes or project names. */
export function t(source:string,...values:unknown[]):string {
 const match=/^(\s*)(.*?)(\s*)$/s.exec(source)!;
 const translated=active==='en'?(english[match[2]]??match[2]):match[2];
 return (match[1]+translated+match[3]).replace(/\{(\d+)\}/g,(token,index)=>
  Number(index)<values.length?String(values[Number(index)]):token);
}
/** API messages remain stable; localization happens at the presentation boundary. */
export function translateError(message:string):string {
 if(['Failed to fetch','Load failed','NetworkError when attempting to fetch resource.'].includes(message))
  return t('No se ha podido conectar con el servidor.');
 const invalidText=/^(.+): texto inválido \(máximo (\d+)\)\.$/.exec(message);
 if(invalidText)return t('{0}: texto inválido (máximo {1}).',t(invalidText[1]),invalidText[2]);
 for(const kind of ['valor','número','fecha']){
  const match=new RegExp('^(.+): '+kind+' inválid[oa]\\.$').exec(message);
  if(match)return t('{0}: '+kind+' inválid'+(kind==='fecha'?'a':'o')+'.',t(match[1]));
 }
 const incomplete=/^Estructura incompleta: faltan (.+)\.$/.exec(message);
 if(incomplete)return t('Estructura incompleta: faltan {0}.',incomplete[1]);
 const field=/^Campo no permitido: (.+)\.$/.exec(message);
 return field?t('Campo no permitido: {0}.',field[1]):t(message);
}
