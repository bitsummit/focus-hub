import {test} from 'node:test';
import assert from 'node:assert/strict';
import {getLanguage,locale,setLanguage,subscribeLanguage,t,translateError} from '../src/i18n.ts';

test('Spanish identity and English dictionary translation never reinterpret unknown user content',()=>{
 try{
  setLanguage('es');assert.equal(getLanguage(),'es');assert.equal(locale(),'es');assert.equal(t('Tareas'),'Tareas');
  const fictional='Revisión ficticia: mañana & reunión $100 <script>nota</script>';assert.equal(t(fictional),fictional);
  setLanguage('en');assert.equal(getLanguage(),'en');assert.equal(locale(),'en');setLanguage('fr' as Parameters<typeof setLanguage>[0]);assert.equal(getLanguage(),'en');assert.equal(t('Tareas'),'Tasks');assert.equal(t(fictional),fictional);
 }finally{setLanguage('es');}
});
test('translation preserves surrounding whitespace and literal dollar replacement text in indexed interpolation',()=>{
 try{
  setLanguage('en');assert.equal(t('  Tareas\n'),'  Tasks\n');
  const literal='$& $$ $` $\' ficticio';assert.ok(t('Hasta {0}',literal).includes(literal));assert.equal(t('Desconocido {0} / {1}',literal,'segundo'),'Desconocido '+literal+' / segundo');
  assert.equal(t('Desconocido {0}',0),'Desconocido 0');assert.equal(t('Desconocido {0}',''),'Desconocido ');
  setLanguage('es');assert.equal(t('Hasta {0}','mañana'),'Hasta mañana');
 }finally{setLanguage('es');}
});
test('language observers receive actual preference changes and unsubscribe cleanly',()=>{
 setLanguage('es');let calls=0;const unsubscribe=subscribeLanguage(()=>calls++);
 try{setLanguage('en');assert.equal(getLanguage(),'en');assert.equal(calls,1);setLanguage('en');assert.equal(calls,1);unsubscribe();setLanguage('es');assert.equal(calls,1);}finally{unsubscribe();setLanguage('es');}
});

test('API validation and connection errors are localized without rewriting field values',()=>{
 try{
  setLanguage('en');assert.equal(translateError('Idioma: valor inválido.'),'Language: invalid value.');
  assert.equal(translateError('Nombre: texto inválido (máximo 150).'),'Name: invalid text (maximum 150).');
  assert.equal(translateError('Campo no permitido: user_id.'),'Field not allowed: user_id.');
  assert.equal(translateError('Failed to fetch'),t('No se ha podido conectar con el servidor.'));
  setLanguage('es');assert.equal(translateError('Idioma: valor inválido.'),'Idioma: valor inválido.');
 }finally{setLanguage('es');}
});
