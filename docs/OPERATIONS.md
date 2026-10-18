# Focus. — Operaciones

Esta es la guía operativa para el repositorio privado
[bitsummit/focus-hub](https://github.com/bitsummit/focus-hub). Los requisitos de
seguridad y las puertas previas a datos reales están en [SECURITY.md](SECURITY.md).
Los comandos siguientes se ejecutan en Bash, desde la raíz del repositorio,
con Node.js 24 o superior. No contienen contraseñas.

## Abrir y reabrir Codespaces

1. Entra en GitHub con la cuenta autorizada y abre la rama
   [`dev/focus-hub-v1.1-ux-readiness`](https://github.com/bitsummit/focus-hub/tree/dev/focus-hub-v1.1-ux-readiness).
2. Para conservar tus datos, abre **Code → Codespaces → tu Codespace existente**.
   También puedes encontrarlo en [github.com/codespaces](https://github.com/codespaces).
   Crea uno nuevo solo si necesitas otro entorno: selecciona esa rama y
   `.devcontainer/devcontainer.json`. La configuración solicita 2 CPU, 4 GB de RAM
   y 8 GB de almacenamiento.
3. La primera creación ejecuta `.devcontainer/setup.sh`: comprueba Node, instala
   con `npm ci`, compila y genera una demo ficticia solo si no existe. Cada arranque
   ejecuta `.devcontainer/start.sh`: inicia Vite y API en el mismo puerto 3000 y
   verifica el acceso a la demo. No imprime contraseñas.
4. Abre **Ports / Puertos** en el panel inferior de VS Code. Si está oculto, usa
   **View → Terminal** para abrir el panel y selecciona su pestaña **Ports**.
   Comprueba **3000 → Port Visibility → Private** y pulsa **Open in Browser**.
   En móvil puedes abrir esa misma URL HTTPS desde un navegador autenticado en
   GitHub; la app de GitHub no mantiene el servidor encendido.

La visibilidad es una propiedad de GitHub, no una garantía del archivo devcontainer.
Un puerto nuevo es privado por defecto; verifica también los Codespaces reutilizados.
No selecciones **Public** ni **Private to Organization**. Con GitHub CLI autenticado,
la alternativa explícita es:

```sh
gh codespace ports visibility 3000:private --codespace "$CODESPACE_NAME"
```

El servicio escucha en `127.0.0.1`; GitHub proporciona forwarding HTTPS privado.
El origen y las cookies se configuran desde las variables oficiales de Codespaces.
La autenticación de GitHub y el login de Focus. son barreras distintas.

## Demo, credenciales y bases separadas

| Archivo | Función |
|---|---|
| `.data/demo.sqlite` | Base ficticia creada por `npm run demo`; la usa el autoarranque. |
| `.data/demo-access.json` | Correo y contraseña aleatoria de esa demo, solo en el entorno local. |
| `.data/focus-hub.sqlite` | Ruta por defecto de `npm start`, `npm run dev` y `npm run owner` fuera del gestor de demo. |
| `.data/codespaces-server.pid` / `.log` | Identidad/configuración del proceso gestionado y diagnóstico local. |

Para obtener el acceso de prueba sin imprimirlo en el terminal:

```sh
code .data/demo-access.json
```

Copia `email` y `password` al formulario. El correo ficticio no necesita buzón.
Guarda las credenciales en un gestor de contraseñas; no las pegues en chats,
issues, capturas o commits. La contraseña se genera criptográficamente, no se
comparte una fija. `.data` está ignorada por Git; sus nuevos directorios tienen
modo 0700 y los archivos sensibles 0600.

Reabrir el mismo Codespace conserva normalmente la base y credenciales. Otro
Codespace tiene otra demo y contraseña. El script de preparación rechaza una pareja
incompleta de base/archivo de acceso, sin sobrescribirla; el arranque nunca siembra.
Si falta la base de una instancia usada, **no ejecutes demo para recuperarla**:
primero localiza y restaura una copia. Una nueva demo no recupera tus tareas.

Para instalar y preparar una demo nueva fuera del autoarranque:

```sh
bash .devcontainer/setup.sh
bash .devcontainer/start.sh
```

No uses la demo como base personal. Una base personal requiere una ruta explícita,
credenciales propias y cumplir las condiciones de [SECURITY.md](SECURITY.md).
La creación inicial local es `FOCUS_DB=.data/personal.sqlite npm run owner` sobre
una ruta nueva elegida conscientemente; solicita correo, nombre y contraseña oculta.
No hay registro público ni recuperación por correo. No ejecutar semillas sobre
una base personal ni utilizar pruebas destructivas con ella.

## Actualizar la única rama dev

`dev/focus-hub-v1.1-ux-readiness` es nuestra rama **dev** permanente; `main` contiene
la integración estable. No crear una rama llamada `dev`, ramas por tarea ni worktrees.
Los cambios habituales se guardan en la dev existente cuando su publicación esté
autorizada. Una integración dev → main requiere revisión y aprobación expresa del
propietario; no hay PR por tarea ni merges automáticos a main.

Antes de actualizar, revisa `git status`. Si tienes cambios locales, consérvalos
mediante un commit o una copia aparte y resuelve su integración antes de continuar.
Desde la raíz del Codespace:

```sh
git status
git remote set-branches origin '*'
git fetch --prune origin
git switch dev/focus-hub-v1.1-ux-readiness
git merge --ff-only origin/dev/focus-hub-v1.1-ux-readiness
```

Esto permite actualizar incluso un clon que originalmente solo seguía `main`.
No crea ramas remotas; `switch` puede establecer el seguimiento local de la dev
existente. Si Git rechaza el cambio o el avance rápido, detente y conserva la
salida: no uses `reset --hard`, `clean`, cambios forzados, force push ni reescritura
de historia. No borres una rama obsoleta sin verificar antes que sus commits estén
contenidos en la dev permanente.

Los cambios de Codex llegan a otro checkout: hay que traerlos con Git al Codespace.
Actualizar código no guarda tus datos en Git ni cambia tu contraseña.

## Desarrollo, reinicio y comprobaciones

En la demo gestionada, Vite sirve `src` con HMR por el mismo puerto privado 3000.
CSS y frontend cambian al guardar, sin reconstruir el contenedor ni compilar cada
vez. Para cambios del backend/configuración, reinicia; para dependencias nuevas,
reinstala antes de arrancar:

```sh
node .devcontainer/service.mjs stop
npm ci
bash .devcontainer/start.sh
```

Omite `npm ci` si no cambiaron dependencias. `start.sh` es idempotente, verifica la
demo existente y no duplica procesos. No detiene un proceso ajeno que ocupe el puerto.
El gestor depende de Linux y `/proc`. Detén con Ctrl+C los servidores arrancados
manualmente; no los confundas con el proceso gestionado.

Arranque manual de desarrollo de la demo, con el gestor previamente detenido:

```sh
FOCUS_DB=.data/demo.sqlite npm run dev
```

Para probar la entrega compilada en esa misma demo, detén el servidor anterior:

```sh
npm run build
FOCUS_DEV=false bash .devcontainer/start.sh
```

Para una base personal o recuperada, usa un proceso compilado separado, sin el
gestor de demo: `FOCUS_DEV=false FOCUS_DB=.data/personal.sqlite PORT=3000 npm start`.
La ruta debe corresponder a la base preparada; abrir una ruta equivocada puede crear
una base vacía. `start.sh` fija siempre la base demo, aunque le pases otro `FOCUS_DB`.
No es un mecanismo de selección permanente de una base personal.

Comprobaciones reproducibles con datos ficticios:

```sh
npm run smoke:demo
npm run build
npm test
npm run test:e2e
npm audit
```

`smoke:demo` necesita la demo gestionada activa; inicia/cierra una sesión de prueba,
lee sus registros y no crea tareas. Cuenta contra el presupuesto de login: no
repitas arranques/smokes en bucle si aparece 429; espera el `Retry-After`.
Las demás suites usan fixtures ficticios aislados. Playwright requiere Chromium:
por defecto `/usr/bin/chromium`, configurable con `CHROMIUM_PATH`. En la imagen
Debian de Codespaces se puede instalar con `sudo apt-get update` y después
`sudo apt-get install -y chromium`. No ejecutar dos suites de navegador a la vez
(usan 4173), ni reconstruir `dist` durante ellas. Los resultados son evidencia
local; no certifican la cuenta, el proxy o los dispositivos reales del propietario.

## Capturas reproducibles

Después de `npm run build`, los scripts arrancan su propio servidor en un puerto
local efímero y usan únicamente una base temporal ficticia que eliminan al terminar:

```sh
npx tsx scripts/brand-screenshots.ts
npm run screenshots:v11
```

La salida por defecto es `test-results/brand` (login/aplicación, escritorio/móvil,
claro/oscuro) y `test-results/ux-v11` (vistas operativas). Ambas carpetas están
ignoradas por Git. Admiten como primer argumento una carpeta de salida alternativa.
No apuntarlos a un directorio con datos personales. Las cuatro capturas versionadas
en `docs/screenshots/brand` son referencias seleccionadas, no snapshots de todos
los tests: reemplazarlas deliberadamente desde la salida si cambia la interfaz.
Las capturas diagnósticas de idioma y diario también permanecen fuera de Git.

## Diagnóstico sin perder datos

- **No aparece el puerto o no responde:** reabre el Codespace existente, ejecuta
  `bash .devcontainer/start.sh` y revisa localmente `.data/codespaces-server.log`.
  No crees otro entorno como primera solución. Comprueba cuota e inactividad de GitHub.
- **«Origen no permitido», incluso al salir:** no es un fallo de contraseña. Actualiza
  dev y reinicia el backend como arriba; recarga el formulario. Tras un intento,
  consulta solo el diagnóstico acotado:

  ```sh
  grep FOCUS_ORIGIN_REJECTED .data/codespaces-server.log | tail -3
  ```

  Incluye origen/host y metadatos de procedencia, no contraseñas ni cookies.
  No compartas logs completos sin revisarlos. No desactives CSRF ni añadas dominios
  comodín: los límites del proxy permitido están en [SECURITY.md](SECURITY.md).
- **Símbolo/fuente 403:** actualiza y reinicia el backend; desarrollo admite
  explícitamente `/brand-symbol.svg` y `/fonts/manrope-variable.woff2` sin exponer
  todo `public`. No amplíes la exposición de archivos para resolverlo.
- **Volver al login:** pulsa «Cerrar sesión / Sign out». Para verlo conservando la
  sesión actual, abre la URL en incógnito y autentícate primero en GitHub si lo pide.
- **Base o acceso de demo incompleto:** conserva los archivos, evita regenerar o
  borrar nada y revisa rutas/copias. La contraseña no se resetea por actualizar código.

## Rotación de contraseña

Para la demo existente:

```sh
FOCUS_DB=.data/demo.sqlite npm run password
```

Introduce correo y nueva contraseña de 12–256 caracteres dos veces mediante entrada
oculta. Usa una frase larga y única de un gestor, no una publicada en una conversación.
Para otra cuenta utiliza su ruta existente en `FOCUS_DB`; el comando no crea bases
ni cuentas. Revoca todas las sesiones de esa cuenta y conserva tareas y otras cuentas.
En la demo actualiza también `demo-access.json` sin imprimirlo. No interrumpas la
rotación: SQLite y ese JSON no comparten una transacción resistente a cualquier
apagado; consulta el riesgo en [SECURITY.md](SECURITY.md).

## Copia consistente y custodia externa

No sustituyas el backup por `cp` de SQLite activo: cambios confirmados pueden estar
en WAL. Elige una ruta de salida nueva cada vez; cambia en los ejemplos la fecha/hora
por la de tu copia. Usa `--source` para seleccionar conscientemente demo o base personal.

```sh
npm run backup -- --source .data/demo.sqlite --out .data/backups/focus-2026-10-18-120000.sqlite
npm run backup:verify -- --source .data/backups/focus-2026-10-18-120000.sqlite
```

La copia online incluye transacciones confirmadas y excluye cambios sin confirmar;
representa un punto confirmado durante la operación. Abre la fuente de solo lectura
sin migrarla. Verifica `integrity_check`, `foreign_key_check`, esquema completo
compatible 001/002 y conteos de trece tablas. Publica la salida mediante enlace duro
atómico sin reemplazo: falla si el destino, un symlink o sus sidecars ya existen.
El directorio debe admitir enlaces duros; no hay fallback inseguro.

El informe muestra rutas, comprobaciones, conteos y `mainFileSha256`, sin contenido
de registros ni hashes de contraseña. El checksum cubre solo el archivo principal:
**no incluye WAL de una base activa**; sí permite comparar una copia cerrada sin WAL
con su descarga. Conserva el commit de código compatible con cada copia. La
verificación estricta puede rechazar esquemas futuros; no vuelvas a ejecutar código
anterior contra una base ya migrada. Las copias 001 se migran solo al abrir normalmente
el archivo restaurado con el servidor actual, no al verificarlo o copiarlo.

**Descarga la copia fuera del Codespace** desde el explorador y guárdala cifrada en
almacenamiento privado. `.data/backups` comparte el riesgo del Codespace. No subas
bases, WAL/SHM, exportaciones privadas, credenciales o respaldos a Git. Los backups
incluyen cuentas, hashes y sesiones y requieren custodia sensible. Los archivos
creados tienen 0600; nuevos directorios 0700, sin cambiar permisos de directorios
preexistentes. No uses directorios públicos o compartidos.

Antes de datos reales: ensayo completo de recuperación de una copia externa.
Para un piloto manual: copia diaria y antes de actualizaciones/importaciones,
varias versiones externas y ensayos periódicos. No hay cifrado, programador ni envío
externo automático. Exportar JSON/CSV desde Ajustes sirve para portabilidad; no hay
importador JSON completo y no sustituye la recuperación SQLite.

## Restaurar sin reemplazar datos existentes

Detén el gestor y cualquier servidor manual del checkout. El restore rechaza un PID
gestionado activo del directorio actual; **no detecta todos los procesos manuales**
ni detiene procesos por su cuenta. No renombres, borres ni sobrescribas la base original.

```sh
node .devcontainer/service.mjs stop
npm run backup:verify -- --source .data/backups/focus-2026-10-18-120000.sqlite
npm run restore -- --source .data/backups/focus-2026-10-18-120000.sqlite --out .data/recovered-2026-10-18-120000.sqlite
npm run backup:verify -- --source .data/recovered-2026-10-18-120000.sqlite
npm run build
FOCUS_DEV=false FOCUS_DB=.data/recovered-2026-10-18-120000.sqlite PORT=3000 npm start
```

La salida debe ser nueva, sin archivo ni WAL/SHM/journal existentes. Se preservan
usuarios, contraseñas de la fecha del respaldo, preferencias, relaciones, tareas
borradas lógicamente, eventos, fechas, diario, foco e idempotencia. Solo se eliminan
las sesiones de la **copia restaurada**: vuelve a iniciar sesión. Fuente y respaldo
permanecen intactos. Verifica proyectos, diario, tareas, historial y foco desde el
navegador privado. Cierra la prueba con Ctrl+C; `bash .devcontainer/start.sh` vuelve
a la demo, no adopta automáticamente la base recuperada.

Si se perdió el Codespace, crea otro con código compatible, instala dependencias,
descarga la copia externa a un directorio privado y sigue desde su verificación.
No ejecutes semillas ni importaciones sobre ella. Adoptar la base recuperada como
personal de forma permanente requiere configurar conscientemente su ruta y arranque.

## Persistencia, disponibilidad y próximo entorno estable

- Detener/suspender conserva normalmente el workspace, pero apaga el acceso.
- Reconstruir conserva normalmente `/workspaces`; otros archivos pueden desaparecer.
  Haz primero una copia externa: conservación habitual no equivale a garantía.
- Eliminar el Codespace/almacenamiento borra `.data`, que no está en Git. Un push
  conserva código, **no tareas**. Retención, cuotas e inactividad dependen de GitHub.
- Móvil y ordenador usan la misma URL/base mientras ese Codespace esté activo;
  protege GitHub con MFA y no cambies el puerto a público para facilitar el acceso.
- La imagen completa, forwarding y sesión de la cuenta real deben comprobarse en
  Codespaces. Tests locales del proxy y scripts no sustituyen esa comprobación;
  no se ha certificado el servicio del proveedor como hosting cotidiano.

Propuesta posterior, sin desplegarla ni cambiar arquitectura: un proceso Node
compilado privado con disco persistente SQLite, HTTPS, DEV/base personal separados,
secretos fuera de Git, backups consistentes cifrados fuera del proveedor y objetivos
de pérdida/tiempo de recuperación acordados. Revisar proveedor, costes y límites
antes de elegir; no prometer que un nivel gratuito será permanente. Workers/D1
requeriría adaptación y discusión previa. No publicar ni contratar sin autorización.

Referencias del entorno: [puertos de Codespaces](https://docs.github.com/en/codespaces/developing-in-a-codespace/forwarding-ports-in-your-codespace),
[esquema devcontainer](https://github.com/devcontainers/spec/blob/main/schemas/devContainer.base.schema.json),
[imagen Node](https://github.com/devcontainers/images/tree/main/src/javascript-node).
