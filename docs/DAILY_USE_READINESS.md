# Uso cotidiano y recuperación · Focus. v1.1

## Dictamen y límites

La aplicación mantiene Node/Express/SQLite y una única tarea canónica. Esta entrega
no migra arquitectura, no publica un alojamiento y no inspecciona la base personal.
Las pruebas usan cuentas ficticias y directorios temporales.

**El piloto privado con datos ficticios es adecuado; las pruebas locales no
certifican que Codespaces sea un alojamiento estable ni que los datos reales estén
protegidos por una copia externa.** Antes de importar información real deben existir
una base personal separada, credenciales propias y copia privada fuera del Codespace,
con un ensayo de recuperación de esa copia. No se conecta Notion automáticamente.

## Matriz de preparación

| Área | Comportamiento y evidencia | Límite operativo |
|---|---|---|
| Persistencia | SQLite en archivo, WAL, transacciones; prueba API de conexión nueva y recuperación íntegra de copia | Verificación de reinicio completo y navegador en la matriz UX de esta entrega; la cuenta del usuario no se controla desde aquí |
| Autenticación | Cookies HttpOnly/SameSite Strict/Secure en HTTPS; tokens de sesión hash; CSRF y desafío previo al login | Sesiones de siete días, sin renovación deslizante; GitHub requiere su propia sesión para el puerto privado |
| Integridad | Tareas, eventos y referencias comparten identificadores; FK; cambios y eventos atómicos | No hay edición colaborativa en tiempo real |
| Concurrencia | Captura y diario usan request_id; un reintento idéntico no duplica; diario con revisión y conflicto 409 | Mismo campo de tarea: última escritura. No promete fusión automática entre dispositivos |
| Fechas | UTC en eventos; calendario IANA con Temporal, semana configurable y tests DST 23/25 horas | Revisar zona horaria en Ajustes antes del piloto; no inventar fechas de una futura importación |
| Exportaciones | JSON con historial y relaciones; CSV con neutralización de fórmulas | JSON/CSV no son un mecanismo de restauración completo de la instancia |
| Recuperación | Copia SQLite online consistente, integridad/FK/esquema, restauración solo a destino nuevo, sesiones revocadas | No hay planificador, envío externo ni cifrado automático. Debe hacerse y custodiarse externamente |
| Disponibilidad | Acceso HTTPS privado desde móvil/ordenador con la cuenta GitHub autorizada | Codespaces se suspende, consume cuota y puede eliminarse; Vite sirve desarrollo |

La contraseña corta de la demo fue una decisión explícita del propietario: esta
iteración no la cambia ni invalida esa demo. Una cuenta personal para datos reales
necesita contraseña única y fuerte; no reutilizar una publicada en una conversación.
El acceso a GitHub debe protegerse con MFA. SQLite y sus copias no están cifradas
por la aplicación; quien controla la terminal puede leerlas.

## Copia consistente y comprobación

Ejecutar desde la raíz del repositorio con Node 24 y dependencias instaladas. No
utilizar `cp` de un archivo SQLite activo como sustituto de una copia consistente:
puede haber cambios confirmados todavía en WAL.

```sh
npm run backup -- --source .data/demo.sqlite --out .data/backups/focus-2026-10-16.sqlite
npm run backup:verify -- --source .data/backups/focus-2026-10-16.sqlite
```

Elegir un nombre nuevo cada vez (fecha/hora única); nunca sobrescribir. Puede
respaldarse una base activa: `node:sqlite.backup` incluye transacciones confirmadas,
excluye cambios sin confirmar y entrega una imagen coherente. Si hay escritura
concurrente, la imagen representa un punto confirmado durante la copia, no todos
los cambios que sucedan posteriormente.

La herramienta abre la fuente de solo lectura y no aplica migraciones. Comprueba
`integrity_check`, `foreign_key_check`, el esquema completo compatible (001 original o 002 con idioma de usuario) y el número de filas de sus trece tablas. Crea un archivo provisional
privado y publica mediante enlace duro atómico sin reemplazo: falla si el destino,
un symlink o sus archivos auxiliares ya existen. El sistema de archivos debe
permitir enlaces duros en ese directorio; no se intenta una alternativa insegura.

El resultado muestra rutas, comprobaciones, cuentas de filas y `mainFileSha256`;
nunca títulos, correos, contraseñas ni hashes de contraseña. Ese checksum describe
el archivo principal: en una base activa **no incluye WAL** ni debe usarse para
compararla con la copia. Para una copia cerrada y sin WAL sí permite comprobar
que el archivo descargado es idéntico. La validación estricta del esquema admite 001 y 002 y puede
rechazar versiones futuras: conservar código/commit compatible con cada copia.

**Descargar la copia fuera del Codespace** desde el explorador de archivos de
GitHub y guardarla en almacenamiento privado cifrado. Una copia en `.data/backups`
se pierde junto al Codespace. No subir SQLite, sidecars ni copias a Git. Las copias
incluyen cuentas, hashes de contraseña y sesiones: custodiar como datos sensibles.
Archivo 0600 y nuevos directorios 0700; directorios ya existentes no cambian sus
permisos automáticamente. No alojarlas en directorios compartidos o públicos.

Para un piloto manual: copia al final de cada jornada y antes de actualizaciones,
importaciones o cambios importantes; conservar varias versiones externas y ensayar
restauración periódicamente. La herramienta no garantiza ese hábito ni envía nada.

## Recuperación ensayable, sin reemplazar datos

Primero detener el servicio del checkout y cualquier `npm start`/`npm run dev`
arrancado manualmente. El comando detecta un PID gestionado activo en
`.data/codespaces-server.pid` del directorio actual y se niega a continuar; nunca
mata procesos. **No detecta todos los servidores no gestionados**: comprobarlos y
detenerlos manualmente. Ejecutar siempre desde la raíz del checkout correspondiente.

```sh
node .devcontainer/service.mjs stop
npm run backup:verify -- --source .data/backups/focus-2026-10-16.sqlite
npm run restore -- --source .data/backups/focus-2026-10-16.sqlite --out .data/recovered-2026-10-16.sqlite
npm run backup:verify -- --source .data/recovered-2026-10-16.sqlite
```

El destino debe ser nuevo: nunca sustituye la base existente ni sus archivos WAL,
SHM o journal. Se preservan usuarios, contraseña, preferencias, relaciones, tareas
borradas lógicamente, eventos, fechas, diario, foco e idempotencia. Se eliminan
**solo las sesiones de la copia restaurada**, obligando a volver a iniciar sesión;
la fuente y la copia original no se modifican. La cuenta conserva la contraseña
que tenía al realizar el respaldo, no necesariamente la más reciente.

Para probar la recuperación por separado, con proceso compilado y sin cambiar la
configuración de autoarranque de la demo:

```sh
npm run build
FOCUS_DB=.data/recovered-2026-10-16.sqlite PORT=3000 npm start
```

En Codespaces el servidor deduce el origen HTTPS desde sus variables oficiales;
el puerto 3000 debe continuar **Private**. Abrir su URL, iniciar sesión y comprobar
proyectos, historial, diario y foco. Cerrar ese proceso con Ctrl+C al terminar.
El autoarranque `.devcontainer/start.sh` sigue utilizando `.data/demo.sqlite`,
por diseño: **no cambia automáticamente al archivo recuperado**. Para volver a la
demo: `bash .devcontainer/start.sh`. No renombrar ni borrar la base anterior para
hacer el ensayo. Adoptar una base personal/recuperada de forma permanente requiere
configurar conscientemente su ruta y un arranque sin las asunciones de la demo.

Si se pierde el Codespace, crear otro desde el commit compatible, instalar
`npm ci`, descargar la copia externa a un directorio privado e iniciar desde el
paso de verificación/restauración. No ejecutar semillas ni importaciones sobre la
copia. Una restauración SQLite completa es diferente de una futura importación
selectiva de JSON; esa importación no se implementa aquí.

## Qué ocurre al detener, reconstruir o eliminar Codespaces

- Detener/suspender apaga el servidor y corta el acceso, pero conserva normalmente
  el volumen y la base. Al reiniciar cambian los procesos, no las tareas.
- Reconstruir el contenedor conserva normalmente `/workspaces`, donde vive el
  repositorio. Archivos fuera del volumen de trabajo pueden desaparecer. Antes de
  reconstruir, respaldo externo; no confundir esta conservación con garantía.
- Eliminar el Codespace o su almacenamiento borra `.data`, ignorada por Git. Un
  push preserva código, **no tus tareas**. También hay políticas de retención,
  cuota e inactividad de GitHub ajenas a la aplicación.
- Autoarranque preserva demo existente y rechaza pares incompletos de DB/archivo
  de acceso. Si la base falta completamente, puede crear una demo ficticia nueva:
  no interpretarla como recuperación de tus datos.

## Acceso cotidiano privado y futura propuesta

Mantener el puerto 3000 privado, sesión GitHub protegida, HTTPS y login de la app.
Móvil y escritorio acceden a la misma URL y base únicamente mientras el Codespace
está activo. No activar Public para evitar autenticaciones ni dejar Vite como PRO.
No se ha abierto un puerto ni desplegado un servicio como parte de esta entrega.

Para uso estable, propuesta posterior **sin ejecutarla ahora**: un único proceso
Node compilado en alojamiento privado con disco persistente para SQLite, HTTPS,
base personal separada de DEV, secretos fuera de Git, copias consistentes cifradas
fuera del proveedor y ensayo de recuperación con RPO/RTO acordados. Mantiene la
arquitectura; proveedor, costes y disponibilidad deben comprobarse antes de elegir.
Una alternativa Workers/D1 implica adaptación tecnológica y requiere conversación
previa. Ningún nivel gratuito debe prometerse permanente o suficiente sin revisar
sus condiciones. No se ha contratado, migrado ni publicado nada.

## Evidencia de recuperación de esta iteración

`node --import tsx --test tests/recovery.test.ts`: **6 pruebas aprobadas**, sin
omisiones. Bases aisladas ficticias; ninguna `.data` existente se abre o modifica.

1. Copia con escritor WAL abierto; restauración del grafo completo con mismos
   identificadores, relaciones, fechas, eventos de completar/reabrir, borrado lógico,
   foco y preferencias. La contraseña sigue verificando; sesiones restauradas cero.
2. Transacción no confirmada excluida de la copia.
3. Rechazo de sobrescrituras, alias, symlinks y sidecars existentes.
4. Rechazo de archivo corrupto, esquema distinto y relaciones inválidas.
5. Rechazo de restauración ante PID gestionado activo, sin señalarlo ni detenerlo.
6. Comandos reales CLI backup/verify/restore con conteos sin contenido personal.

Las pruebas no reemplazan descargar y restaurar una copia del Codespace real ni
una revisión del futuro hosting. Persistencia de navegador/reinicio y criterios UX
se resumen con el resto de evidencia en `docs/UX_REVIEW_V1_1.md` al cerrar la fase.

### Validación final de navegador y reinicio real

La suite completa final pasó **14/14 E2E en Chromium** y **48/48 pruebas de
backend/lógica**, sin omisiones. `tests/daily-readiness.spec.ts` ejecutó sobre una
base temporal ficticia: captura por navegador, recarga, logout/login, SIGTERM del
proceso propio y arranque nuevo sobre el mismo archivo. Se conservaron sesión y
tarea. Después se realizó backup online por CLI, parada, restore a un archivo
nuevo y arranque sobre él: sesión anterior rechazada, nuevo login correcto,
proyecto/diario/tareas y eventos de completar/reabrir preservados.

`tests/ux-v11.spec.ts` perdió deliberadamente una respuesta después de confirmar
la escritura: el reintento conservó request_id y produjo exactamente una tarea y
un evento de creación. Las pruebas existentes entre dos pestañas conservaron un
estado remoto al editar descripción y rechazaron la edición obsoleta del diario.
La auditoría npm de dependencias de desarrollo y ejecución devolvió cero
vulnerabilidades conocidas en la fecha de entrega. Esto no equivale a una
auditoría externa ni garantiza disponibilidad del proveedor.

Sigue pendiente la comprobación con el Codespace y dispositivos reales del
propietario, el almacenamiento externo de una copia y su recuperación ensayada.
No se debe pasar de datos ficticios a reales solo por estos resultados locales.


### Preferencia de idioma y copias existentes

La migración aditiva `002_language.sql` añade `users.language` (`es`/`en`,
predeterminado `es`) sin reescribir tareas, diario, relaciones ni histórico.
El arranque normal la aplica de forma transaccional una sola vez. Las copias
anteriores con esquema 001 siguen pudiendo verificarse y restaurarse: verificar,
respaldar y restaurar no migran su fuente. El archivo restaurado se actualiza
únicamente al abrirlo con el servidor de esta versión. Una copia con esquema 002
conserva también el idioma de cada usuario. No ejecutar una versión anterior del
código sobre una base ya migrada; conservar código compatible con la copia.
