# Focus. — Operaciones

Guía del repositorio privado [bitsummit/focus-hub](https://github.com/bitsummit/focus-hub).
Los controles y requisitos antes de datos reales están en [Seguridad](SECURITY.md).
Ejecuta los comandos desde la raíz del repositorio en Bash, con Node.js 24 y npm.
Ningún ejemplo contiene secretos. No pegues URLs de conexión en chats, capturas,
argumentos de comandos ni archivos versionados.

## Abrir y reabrir Codespaces

1. Abre la rama permanente
   [`dev/focus-hub-v1.1-ux-readiness`](https://github.com/bitsummit/focus-hub/tree/dev/focus-hub-v1.1-ux-readiness).
2. Para conservar datos, usa **Code → Codespaces → tu Codespace existente**, también
   disponible en [github.com/codespaces](https://github.com/codespaces). Crear otro
   entorno no recupera datos del anterior. Uno nuevo usa `.devcontainer/devcontainer.json`
   con Node 24, Docker-in-Docker, 2 CPU, 4 GB de RAM y 8 GB de almacenamiento solicitado.
3. `.devcontainer/setup.sh` instala dependencias, compila, prepara PostgreSQL local,
   aplica migraciones y crea datos ficticios solo en una demo nueva y vacía. Si encuentra
   una demo SQLite anterior, se detiene: sigue la migración explícita de esta guía.
   `.devcontainer/start.sh` inicia API y Vite en el mismo puerto 3000; nunca siembra.
4. Abre **Ports / Puertos** en el panel inferior; si no aparece, usa **View → Terminal**
   y elige la pestaña **Ports**. Comprueba **3000 → Port Visibility → Private** y pulsa
   **Open in Browser**. Desde móvil abre esa URL HTTPS en un navegador autenticado en
   GitHub; la app de GitHub no mantiene el servicio encendido.

El archivo no garantiza la visibilidad efectiva: revisa también Codespaces reutilizados.
No selecciones **Public** ni **Private to Organization**. Con GitHub CLI autenticado:

```sh
gh codespace ports visibility 3000:private --codespace "$CODESPACE_NAME"
```

API y PostgreSQL escuchan en `127.0.0.1`; solo se solicita forwarding de 3000.
No publiques ni abras forwarding del puerto PostgreSQL. El origen HTTPS y las cookies
se configuran con las variables oficiales de Codespaces. El login de GitHub y el de
Focus. son barreras diferentes. La reconstrucción completa de esta configuración,
el forwarding y la cuenta real deben comprobarse en Codespaces: las pruebas locales
no certifican ese entorno ni su disponibilidad cotidiana.

## PostgreSQL local y selección del destino

Se necesita Docker operativo. Desde un entorno nuevo, sin datos previos:

```sh
bash .devcontainer/setup.sh
bash .devcontainer/start.sh
```

La preparación utiliza PostgreSQL 17 con imagen fijada por digest. Cada checkout
identifica su contenedor y volumen mediante nombre/etiquetas propios; no elimina ni
reemplaza recursos ajenos. El puerto PostgreSQL es dinámico y solo loopback.

| Recurso | Función |
|---|---|
| Base `focus_dev` / rol `focus_dev_runtime` | Desarrollo ficticio independiente; migración y alta de propietario explícitas. |
| Base `focus_demo` / rol `focus_demo_runtime` | Demo ficticia; nuevas configuraciones usan credenciales propias. |
| Base `focus_test` / rol `focus_test_runtime` | Fixtures en esquemas aleatorios; cada prueba elimina únicamente su esquema. |
| `.data/postgres-local.json` | Secretos distintos por rol y secreto administrativo privado para preparar recursos locales. |
| `.data/demo-access.json` | Correo, contraseña e identidad del destino de la demo. |
| `.data/codespaces-server.pid` / `.log` | Identidad del proceso gestionado y diagnóstico local. |
| Archivos SQLite anteriores | Orígenes heredados conservados; ya no son la persistencia del servidor. |

Los archivos sensibles nuevos tienen modo 0600 y los directorios nuevos 0700;
`.data` está ignorada por Git. Docker también conserva configuración sensible del
contenedor: limita quién accede al daemon. No imprimas `docker inspect` completo.
Una configuración perdida no se regenera sobre volúmenes existentes. Si desaparece
una base, contenedor o volumen ya inicializado, el helper falla sin crear un reemplazo
vacío. Detente y recupera una copia; no borres configuración para silenciar el error.

Para preparar/reutilizar únicamente el servicio PostgreSQL, sin semillas ni migraciones:

```sh
npm run pg:setup
```

Para preparar un desarrollo ficticio separado de demo y pruebas, sin imprimir secretos:

```sh
node scripts/dev-postgres.mjs run --database dev npm run db:migrate
node scripts/dev-postgres.mjs run --database dev npm run owner
node scripts/dev-postgres.mjs run --database dev npm run dev
```

El alta de propietario se realiza una sola vez y rechaza cuentas existentes. El último
comando arranca manualmente: detén antes el servidor gestionado y termina con Ctrl+C.
El helper `run --database dev|demo|test` selecciona el rol/base dedicados; sin selector
usa `focus_demo`. Una `DATABASE_URL` explícita siempre tiene prioridad;
no modifica archivos de acceso, no siembra y usa `FOCUS_DEMO=false`. Para acciones
habituales de una demo gestionada, también existe:
`node --import tsx .devcontainer/postgres.mjs run npm run COMMAND`.
Este último conserva las comprobaciones que bloquean metadatos SQLite anteriores.

Las contraseñas son aleatorias e independientes; los tres roles no son administradores
y no pueden conectar a las otras dos bases. El rol administrativo `focus` se conserva
para preparar recursos. En demos PostgreSQL preexistentes se conserva la URL gestionada
antigua y su identidad para no romper sesiones/metadatos: **esa demo legacy todavía
utiliza sus credenciales administrativas anteriores**. `run --database demo` permite
seleccionar conscientemente el rol limitado, pero no modifica el archivo de acceso ni
lo adopta como demo gestionada. La sección siguiente permite adoptar el destino de
forma explícita sin modificar ownership, registros ni archivos anteriores.

`npm run dev` y `npm start` no eligen una base por sí mismos: usan `DATABASE_URL`.
Vite/compilado describen cómo se sirve la UI, no qué entorno de datos se selecciona.
`NODE_ENV=production` requiere URL explícita incluso en helpers y rechaza
`FOCUS_DEMO=true`; no prepara Docker ni selecciona una demo como alternativa.
La separación de credenciales de producción debe configurarse en su proveedor;
no existe un entorno productivo provisionado ni verificado.

Un destino diferente se configura mediante `DATABASE_URL` y, opcionalmente,
`DATABASE_SCHEMA` (por defecto `public`, ya existente). Usa secretos del entorno o
entrada oculta, sin incluir la URL en el historial de comandos:

```sh
read -rsp 'DATABASE_URL (entrada oculta): ' DATABASE_URL
printf '\n'
export DATABASE_URL
npm run db:migrate
npm start
# Al terminar el servidor:
unset DATABASE_URL
```

La conexión requiere una base y esquema existentes. `db:migrate` es la acción explícita
que aplica migraciones versionadas; el arranque normal solo verifica su compatibilidad.
`DATABASE_URL` explícita en setup/start se respeta y **no se migra ni siembra**
automáticamente. `FOCUS_DB` identifica SQLite y se rechaza en el servidor PostgreSQL;
no lo uses para seleccionar una nueva base. Las conexiones remotas requieren TLS con
certificado verificado; el pool admite `PG_POOL_MAX` entre 1 y 20 (predeterminado 4).
La conexión real con Neon no está verificada aquí ni hay producción configurada. No utilices una URL personal
como destino de pruebas.

## Adoptar PostgreSQL local y recuperar el autoarranque

Después de importar y comprobar los datos, no elimines SQLite ni `demo-access.json`.
La adopción es local y explícita: elige `demo` o `dev`; no admite conexiones externas,
producción ni un destino vacío. No cambia tu correo/contraseña ni las sesiones de la
aplicación: cambia el rol PostgreSQL utilizado por el proceso gestionado.

1. Descarga un backup PostgreSQL completo y guárdalo cifrado fuera del Codespace.
   Detén el servidor manual con Ctrl+C y el gestionado con
   `node .devcontainer/service.mjs stop`. Nadie debe seguir escribiendo. Si modificaste
   datos después del backup, crea y descarga una copia nueva antes de adoptar.
2. Define la ruta real de esa copia y ejecuta el comando, desde la raíz del checkout:

   ```sh
   backup_path=".data/backups/postgresql-TU-COPIA.json"
   (
     set -euo pipefail
     unset DATABASE_URL DATABASE_SCHEMA FOCUS_DB
     npm run local:adopt -- --database demo --backup "$backup_path"
     bash .devcontainer/start.sh
   )
   ```

   Sustituye `postgresql-TU-COPIA.json` por el archivo existente. El bloque se detiene
   ante cualquier error; no importa datos otra vez ni prepara una demo sustituta.
3. El comando ensaya restore en un esquema privado temporal, compara todas las celdas
   con la copia (excepto sesiones, revocadas solo en el clon), limpia ese esquema y
   compara además el backup con el destino actual bajo locks de lectura. Rechaza copias
   obsoletas, roles administrativos/membresías adicionales y cuentas/workspaces ausentes.
4. Publica `.data/active-postgres.json` (0600) con tipo de destino, identidad y checksum;
   no contiene URL ni contraseñas. No sobrescribe otro destino y repetir la adopción
   del mismo conserva la selección original. Conserva originales y backups intactos.
5. El arranque y setup gestionados comprueban la identidad y el rol dedicado antes de
   usarlo, con `FOCUS_DEMO=false`: no siembran, no usan el antiguo archivo de acceso y
   no abren SQLite. Si faltan configuración, cuenta o destino, fallan sin fallback.
   Reabre el puerto 3000 **Private** y comprueba tareas y diario. Después de reiniciar
   el Codespace, `bash .devcontainer/start.sh` vuelve a usar la selección adoptada.

El CLI detecta un PID gestionado activo pero no todos los escritores manuales; no
mata procesos. No edites ni borres el binding para cambiar de base: utiliza un plan
explícito de recuperación. La cuenta administrativa local sigue siendo necesaria para
mantenimiento; no se ha configurado la separación runtime/migraciones de producción.
El archivo de acceso antiguo se conserva como histórico y no es un gestor de claves
para el destino adoptado; guarda la contraseña vigente de la aplicación por separado.

## Validación real de Neon `focus-db-dev`

La compatibilidad PostgreSQL local no valida Neon. Sin URL privada disponible y
acceso a la consola del proyecto no puede darse esta comprobación por realizada.
No se han creado servicios de pago ni un entorno productivo. Una URL no demuestra
por sí sola el nombre del proyecto/branch Neon: comprobarlo en la consola.

1. En Neon identifica el recurso de **desarrollo** `focus-db-dev` y confirma su
   proyecto, branch, base y rol. Configura `DATABASE_URL` como secreto privado del entorno que ejecuta
   Focus., sin pegarla en chats, comandos, capturas o Git. No reutilices el rol/base de
   producción ni apuntes las pruebas automatizadas a este destino. TLS requiere
   certificado válido; conserva `sslmode` y `channel_binding=require` si Neon lo
   proporciona. La app negocia PLUS sin desactivar validación de certificados; límites
   de parámetros en [Seguridad](SECURITY.md).
2. Con ese destino confirmado, `npm run db:migrate` aplica las migraciones explícitas.
   Si hay datos/tablas incompatibles, detente; no borres ni resetees. En una base nueva
   `npm run owner` crea una cuenta ficticia con entrada oculta; si existe una cuenta,
   no ejecutes demo ni otro bootstrap sobre sus datos.
3. Ejecuta `npm run dev` con la misma URL privada, abre el puerto 3000 **Private**,
   accede con la cuenta ficticia y crea un proyecto y una tarea con título
   `Focus — validación ficticia PostgreSQL`. No se necesita importar datos reales.
4. En el SQL Editor de Neon, sobre la misma branch/base y esquema de `DATABASE_SCHEMA`
   (`public` si no se configuró), ejecuta:

   ```sql
   SELECT current_database(), current_user;
   SELECT version, name FROM schema_migrations ORDER BY version;
   SELECT id, title, project_id, created_at
   FROM tasks WHERE title = 'Focus — validación ficticia PostgreSQL';
   ```

   Comprueba que los registros aparecen y conserva el ID de la tarea ficticia.
   No consultes/publicites hashes de contraseña, sesiones o tablas completas.
5. Detén únicamente ese servidor con Ctrl+C, vuelve a ejecutar `npm run dev` sin
   cambiar URL/esquema y recarga Focus. Comprueba el mismo ID/relación tanto en la UI
   como en Neon. Para modo compilado, detén el anterior y usa `npm run build` y
   `npm start` con la misma configuración; esto no configura producción.

Hasta completar conexión TLS real, migraciones, escritura, consola y reinicio,
**Neon permanece pendiente de validación**. Si aquí solo está disponible el acceso
SQL del backend, reportarlo por separado: no equivale a comprobar la consola de Neon.
No elimines los registros de validación ni aprovisiones recursos sin autorización.

## Acceso y cuentas

Para ver las credenciales ficticias sin imprimirlas en el terminal:

```sh
code .data/demo-access.json
```

Copia `email` y `password`. No hace falta un buzón real para esa demo. Guarda el acceso
en un gestor de contraseñas, no en chats, issues o commits. Otra demo tiene otras
credenciales. Una base o archivo incompletos se conservan sin sobrescribir; una nueva
semilla no recupera tareas perdidas. La preparación nunca adopta automáticamente una
base importada como demo gestionada.

Una base personal necesita un destino distinto, credenciales propias y cumplir
[Seguridad](SECURITY.md). Con `DATABASE_URL` elegida y esquema vacío preparado, ejecuta
`npm run db:migrate` y después `npm run owner`: solicita correo, nombre y contraseña
oculta. No hay registro público ni recuperación por correo. No ejecutar semillas sobre
cuentas o datos existentes.

Para rotar la contraseña de la demo gestionada:

```sh
node --import tsx .devcontainer/postgres.mjs run npm run password
```

Para otro destino usa `npm run password` con su `DATABASE_URL` seleccionada. Introduce
correo y contraseña de 12–256 caracteres dos veces mediante entrada oculta. Se revocan
las sesiones de esa cuenta sin borrar tareas ni otras cuentas. Si los metadatos de demo
corresponden al destino, también se actualizan sin imprimirlos. No interrumpas la operación:
PostgreSQL y el archivo local no comparten una transacción distribuida resistente a
cualquier apagado. Un archivo SQLite de acceso anterior no se transforma automáticamente.

## Actualizar la única rama dev

`dev/focus-hub-v1.1-ux-readiness` es la dev permanente; `main` contiene la integración
estable. No crear una rama llamada `dev`, ramas por tarea ni worktrees. Publicar cambios
requiere autorización; integrar dev → main requiere revisión y aprobación expresa.

Revisa primero `git status`. Conserva cambios locales con un commit o copia aparte y
resuelve su integración antes de actualizar:

```sh
git status
git remote set-branches origin '*'
git fetch --prune origin
git switch dev/focus-hub-v1.1-ux-readiness
git merge --ff-only origin/dev/focus-hub-v1.1-ux-readiness
```

Esto actualiza también clones que antes solo seguían `main`. Si falla el cambio o el
avance rápido, detente: no uses `reset --hard`, `clean`, force push ni reescritura de
historia. No borres ramas antiguas sin verificar que sus commits están preservados.
Hay que traer los cambios al Codespace; actualizar código no guarda tareas en Git ni
cambia contraseñas. Haz copia externa antes de cambios de persistencia.

## Desarrollo, reinicio y comprobaciones

Vite sirve frontend con HMR por el mismo puerto privado 3000. Los cambios React/CSS
se ven al guardar; backend o configuración requieren reinicio y nuevas dependencias,
reinstalación:

```sh
node .devcontainer/service.mjs stop
npm ci
bash .devcontainer/start.sh
```

Omite `npm ci` si no cambiaron dependencias. Si hay migraciones nuevas, aplícalas de
forma explícita al destino correcto antes del arranque. El gestor es idempotente,
verifica destino/migraciones y no detiene un proceso ajeno que ocupe el puerto. Depende
de Linux y `/proc`; detén servidores manuales con Ctrl+C.

Para la entrega compilada:

```sh
node .devcontainer/service.mjs stop
npm run build
FOCUS_DEV=false bash .devcontainer/start.sh
```

Con un destino importado/personal explícito se puede iniciar `npm start` después de
compilar, o usar `node scripts/dev-postgres.mjs run npm start` para seleccionar la base
local conscientemente. Se conservan el contrato HTTP y el login local; Better Auth queda
fuera de esta fase.

Pruebas con fixtures ficticios:

```sh
npm run build
npm test
npm run test:e2e
npm audit --audit-level=high
```

Los wrappers preparan/reutilizan PostgreSQL local y pasan solo `TEST_DATABASE_URL` a
fixtures aislados, sin heredar `DATABASE_URL`, `DATABASE_SCHEMA` ni `FOCUS_DB` de la app.
Una `TEST_DATABASE_URL` explícita debe ser local; un destino remoto dedicado y ficticio
requiere además `TEST_ALLOW_REMOTE_POSTGRES=true`. Nunca apuntar a una base real.
Las pruebas del importador/recuperación heredada crean SQLite ficticio exclusivamente
para comprobar esas herramientas; las pruebas de la aplicación usan PostgreSQL.
`tests/postgres-only.test.ts` además ejecuta servidor, demo y backup/restore con
`node:sqlite` deshabilitado y comprueba fallos sin URL/conexión.
Playwright necesita Chromium (`/usr/bin/chromium`, configurable con `CHROMIUM_PATH`);
en Debian se instala con `sudo apt-get update` y `sudo apt-get install -y chromium`.
No ejecutar dos suites de navegador a la vez ni reconstruir `dist` mientras lo usan
(puerto 4173). Estas pruebas no certifican dispositivos ni proveedor reales.

`node --import tsx .devcontainer/postgres.mjs run npm run smoke:demo` comprueba
login/logout y lectura sin crear tareas; requiere demo gestionada activa. Cuenta contra el presupuesto de login: ante 429, respeta `Retry-After`
y no repitas arranques en bucle.

## Capturas reproducibles

Después de compilar, los scripts usan PostgreSQL ficticio aislado y su propio servidor
local temporal; eliminan sus fixtures al terminar:

```sh
node scripts/test-postgres.mjs brand
npm run screenshots:v11
```

La salida es `test-results/brand` y `test-results/ux-v11`, ignoradas por Git. Admiten una
carpeta alternativa como primer argumento; no apuntarlos a datos personales. Las cuatro
capturas en `docs/screenshots/brand` son referencias seleccionadas, no una colección de
logs o snapshots por tarea.

Para verificar cambios visuales/estructurales, genera la base antes de modificar código:

```sh
npm run build
node scripts/test-postgres.mjs visual baseline
# Aplicar cambios; después:
npm run build
node scripts/test-postgres.mjs visual compare
```

El comparador fija fecha, fixtures y movimiento reducido, y comprueba PNG, estilos,
pseudoelementos y geometría. No sustituye interacciones ni dispositivos reales. Playwright
limpia `test-results` por defecto; preserva la base con otra carpeta privada o ejecuta
E2E con `npm run test:e2e -- --output=/tmp/focus-e2e`. No regeneres la base después de un
cambio para ocultar diferencias; revisa discrepancias antes de aceptar.

## Migrar una copia SQLite sin reemplazar datos

La migración es explícita y de una sola dirección; no se ha ejecutado sobre datos
personales. Conserva el código compatible con cada respaldo. Antes de actuar sobre datos
reales, ensaya con datos ficticios y acuerda el destino. No ejecutes semillas tras importar.

1. Detén todos los escritores SQLite, incluidos servidores manuales. Conserva el original,
   sus credenciales y una copia consistente externa. No uses `cp` de una base activa:
   puede haber cambios confirmados en WAL.
2. Las herramientas SQLite heredadas siguen disponibles y no necesitan PostgreSQL:

   ```sh
   node .devcontainer/service.mjs stop
   npm run backup:sqlite -- --source .data/demo.sqlite --out .data/backups/sqlite-source-copy.sqlite
   npm run backup:sqlite:verify -- --source .data/backups/sqlite-source-copy.sqlite
   ```

   Usa una ruta nueva: no reemplazan destinos ni aceptan symlinks. El backup online
   incluye cambios confirmados en WAL y comprueba integridad, claves foráneas y esquema
   compatible 001/002. `mainFileSha256` de un SQLite activo no incluye su WAL; descarga
   la copia consistente, no solo el archivo principal activo. Conserva también
   `restore:sqlite` para recuperar una copia a otra ruta nueva, sin arrancar el servidor
   PostgreSQL sobre ella. El restore heredado elimina sesiones de la copia restaurada.
3. Selecciona un destino PostgreSQL **vacío** y existente; aplica su esquema. Para el
   PostgreSQL local preparado, estos comandos no alteran el archivo de acceso anterior:

   ```sh
   npm run pg:setup
   node scripts/dev-postgres.mjs run npm run db:migrate
   node scripts/dev-postgres.mjs run npm run db:import:sqlite -- --source .data/backups/sqlite-source-copy.sqlite
   ```

   Si `focus_demo` ya contiene datos, la importación falla sin sobrescribirlos: elige otra
   base vacía mediante `DATABASE_URL`, aplica `npm run db:migrate` y ejecuta
   `npm run db:import:sqlite -- --source .data/backups/sqlite-source-copy.sqlite`.
4. El importador abre la fuente en solo lectura, valida esquema 001/002 e integridad,
   conserva IDs, relaciones, fechas, historial, preferencias, referencias y orden de
   almacenamiento. Comprueba conteos y fidelidad de celdas en una transacción y rechaza
   destinos con registros. Compara huellas del archivo principal y WAL antes/después;
   no bloquea escritores ni garantiza un traslado en caliente. Las sesiones se revocan; contraseñas, cuentas y memberships
   se conservan. Una fuente 001 recibe idioma `es` en el destino, sin modificar la fuente.
5. No se adopta la importación como demo ni se reescriben credenciales. Para probar el
   destino local importado, usa `node scripts/dev-postgres.mjs run npm run dev`; inicia
   sesión con las credenciales anteriores y comprueba tareas, diario, foco, proyectos,
   historial y estadísticas. Para habilitar autoarranque, sigue
   [la adopción explícita](#adoptar-postgresql-local-y-recuperar-el-autoarranque); no borres
   metadatos para saltar la protección. Otro destino se inicia con su `DATABASE_URL`.

Mantén el original y el respaldo externo hasta verificar funcionalidad y recuperación
PostgreSQL. No vuelvas a escribir en SQLite esperando sincronización bidireccional.

## Backup PostgreSQL y recuperación

Selecciona conscientemente el destino. Con PostgreSQL local, usa el wrapper; para otro
servidor configura su `DATABASE_URL` explícita. Elige una ruta de salida nueva cada vez:

```sh
node scripts/dev-postgres.mjs run npm run backup -- --out .data/backups/focus-2026-10-18-120000.json
npm run backup:verify -- --source .data/backups/focus-2026-10-18-120000.json
```

Es un snapshot completo de datos de aplicación en JSON, obtenido con una transacción
`REPEATABLE READ READ ONLY`. Incluye cuentas, hashes de contraseña, sesiones, membresías,
registros, eventos, preferencias e idempotencia; es **información sensible**, no el export
JSON/CSV de Ajustes. El archivo se publica atómicamente sin sobrescribir ni seguir
symlinks, con modo 0600 y directorios nuevos 0700. El informe muestra conteos/checksum,
no contenido de registros. SHA-256 detecta corrupción accidental, no autentica un archivo
frente a manipulación deliberada.

`backup:verify` es offline: valida formato, colecciones, tipos básicos de celdas y checksum
del sobre; **no comprueba por sí solo integridad relacional, reglas de negocio ni
restaurabilidad**. Eso se verifica restaurando en un destino migrado vacío. El formato
no es `pg_dump`, no incluye roles/extensiones/configuración del proveedor ni recuperación
a un instante (PITR); tampoco hay cifrado, programador o envío externo automático.

**Descarga copias fuera del Codespace y guárdalas cifradas en almacenamiento privado.**
`.data/backups` comparte el riesgo del entorno. No subas bases, exports, URLs, credenciales
o copias a Git. Conserva varias versiones y el commit compatible. Antes de datos reales,
ensaya una recuperación desde una copia externa; para un piloto, copia diaria y antes
de importaciones/actualizaciones, con ensayos periódicos.

Puedes ensayar la restauración sin sustituir el origen, con su conexión seleccionada:

```sh
node scripts/dev-postgres.mjs run --database demo npm run backup:rehearse -- --source .data/backups/TU-COPIA.json
```

El ensayo requiere `CREATE SCHEMA` y usa un esquema UUID privado en la misma base
local. No modifica los registros del origen; solo elimina el esquema que acaba de
crear. Compara IDs, relaciones, fechas, histórico y cada celda no perteneciente a
sesiones. Las sesiones del clon quedan vacías; las del origen no se revocan. Una
terminación abrupta o fallo de conexión durante cleanup puede dejar un esquema
`focus_recovery_<UUID>`: revisa su propietario y propósito antes de limpiarlo, nunca
borres esquemas de aplicación. Esto demuestra restaurabilidad del backup, no que
contenga el estado más reciente ni que la copia externa se haya descargado correctamente.
No sustituye recuperación desde una copia externa ni pruebas del proveedor real.

Para recuperar, detén todos los escritores del destino y crea/selecciona conscientemente
otra base PostgreSQL **vacía**, sin reemplazar el origen. Después de configurar su
`DATABASE_URL` y esquema existente:

```sh
node .devcontainer/service.mjs stop
npm run backup:verify -- --source .data/backups/focus-2026-10-18-120000.json
npm run db:migrate
npm run restore -- --source .data/backups/focus-2026-10-18-120000.json
npm run build
npm start
```

Restore verifica migraciones/checksums compatibles, columnas y tipos, inserta con SQL
parametrizado, fuerza constraints y contrasta conteos dentro de una transacción. El
destino debe seguir vacío; cualquier fallo revierte las inserciones. Se conservan IDs,
contraseñas del respaldo, preferencias, relaciones, tareas borradas lógicamente, eventos,
fechas, diario, foco e idempotencia. **Las sesiones restauradas se revocan**: vuelve a
iniciar sesión. Fuente y backup permanecen intactos. Verifica la aplicación y guarda un
backup nuevo; el gestor no adopta automáticamente ese destino ni modifica demo-access.

Si se perdió el Codespace, crea otro con código compatible, instala dependencias,
recupera una copia externa y prepara un destino PostgreSQL vacío. No ejecutes semillas
sobre los datos restaurados. Los exports JSON/CSV de Ajustes siguen siendo portabilidad,
no una copia administrativa restaurable completa.

## Diagnóstico y disponibilidad

- **No responde:** reabre el Codespace existente, comprueba Docker/cuotas/inactividad y
  ejecuta `bash .devcontainer/start.sh`. Revisa logs localmente, sin compartirlos completos.
  No crees otro entorno ni una demo nueva como primera solución.
- **PostgreSQL/migraciones fallan:** verifica destino, credenciales y esquema; no hay
  fallback a SQLite ni base vacía. No borres volúmenes ni archivos de configuración para
  forzar el arranque. Datos perdidos necesitan una copia, no una semilla.
- **«Origen no permitido», incluso al salir:** no es una contraseña incorrecta. Actualiza
  dev, reinicia y recarga; después de un intento consulta solo:

  ```sh
  grep FOCUS_ORIGIN_REJECTED .data/codespaces-server.log | tail -3
  ```

  No muestra contraseñas/cookies; no desactives CSRF ni añadas orígenes comodín.
- **Símbolo/fuente 403:** actualiza y reinicia. Desarrollo admite explícitamente
  `/brand-symbol.svg` y `/fonts/manrope-variable.woff2`; no expongas todo `public`.
- **Ver login:** «Cerrar sesión / Sign out»; para conservar la sesión actual, incógnito
  y autenticación previa en GitHub si la pide.
- Suspender detiene acceso. Eliminar el Codespace puede eliminar datos y configuración;
  Git solo conserva código. Los volúmenes Docker, especialmente con Docker-in-Docker,
  **no tienen garantía de sobrevivir reconstrucción o eliminación**. Incluso si se
  conserva `/workspaces`, eso no garantiza conservar Docker ni recuperar PostgreSQL.
  Haz copia externa antes de reconstruir y comprueba restauración.
- Móvil y ordenador comparten URL/base mientras el Codespace está activo. Protege GitHub
  con MFA y conserva el puerto privado. Retención y cuotas dependen de GitHub.

Neon PostgreSQL es el proveedor gestionado previsto, sin recursos ni credenciales reales
configurados. Un futuro entorno estable necesita Node privado compilado, HTTPS,
PostgreSQL duradero separado de DEV/tests, secretos externos, roles de mínimo privilegio,
backups/PITR acordados y recuperaciones ensayadas. Revisar costes y límites antes de
aprovisionar; no prometer gratuidad permanente. No hay Cloud Run, Better Auth ni despliegue
de producción en esta fase. No publicar ni contratar sin autorización.

Referencias: [puertos Codespaces](https://docs.github.com/en/codespaces/developing-in-a-codespace/forwarding-ports-in-your-codespace),
[esquema devcontainer](https://github.com/devcontainers/spec/blob/main/schemas/devContainer.base.schema.json),
[Docker-in-Docker](https://github.com/devcontainers/features/tree/main/src/docker-in-docker).
