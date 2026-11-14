# Focus. — Seguridad

Este documento describe controles verificables y riesgos actuales; no constituye
una certificación ni un pentest externo. Los procedimientos de actualización,
contraseñas, backups y recuperación pertenecen a [OPERATIONS.md](OPERATIONS.md).
La estructura técnica está en [ARCHITECTURE.md](ARCHITECTURE.md).

## Modelo de confianza

El entorno admitido es un piloto privado: forwarding autenticado de GitHub y login
de Focus. son barreras distintas. Se consideran solicitudes hostiles que alcanzan
el puerto, sitios de terceros, identificadores manipulados y usuarios autenticados
que intentan cruzar espacios o agotar recursos. No se presupone que GitHub sustituya
la autorización del backend.

Quien controla la terminal, el sistema o la cuenta GitHub puede leer/modificar
los secretos de conexión, PostgreSQL y el código. El login web no protege un equipo
comprometido. Bases y copias **no están cifradas por la app**; la protección del
almacenamiento del servidor corresponde al proveedor y debe configurarse. Los controles de archivos de Vite reducen
exposición; no convierten desarrollo en un servidor de producción.

## Controles implementados

| Área | Control actual y límite |
|---|---|
| Alta y administración | Sin registro público ni recuperación por correo. Creación inicial/rotación local por CLI; correo normalizado, contraseña nueva de 12–256 caracteres. No se envían correos. |
| Contraseñas | Nuevos hashes versionados scrypt N=32768, r=8, p=3, sal aleatoria y comparación de tiempo constante. Derivación online asíncrona, máximo dos verificaciones concurrentes; saturación devuelve 503 y `Retry-After`. El hash no se exporta al snapshot web. |
| Sesión | Token aleatorio de 256 bits, almacenado como SHA-256 en PostgreSQL. Cookie HttpOnly/SameSite Strict, Path=/; en HTTPS `__Host-focus_session`, Secure y sin Domain. Rechazo de cookies duplicadas y limpieza de la cookie antigua. Caducidad fija de siete días, sin renovación deslizante. Logout revoca la sesión; contraseña nueva revoca todas las de la cuenta. |
| Carrera login/rotación | Antes de emitir sesión se comprueba transaccionalmente que sigue vigente el hash verificado; un login pendiente no restaura sesiones de una contraseña revocada. |
| Login CSRF | `GET /api/session/challenge` emite desafío de un uso, diez minutos, cookie HttpOnly/SameSite Strict y token para `X-Login-CSRF`. Cookie prefijada `__Host-` y Secure en HTTPS; login solo JSON, con desafío válido y respuesta sin caché. |
| CSRF autenticado | Escrituras, incluido logout, requieren cookie de sesión válida y `X-CSRF-Token` emitido por el servidor. Validación adicional de origen/Host; no se sustituye CSRF por metadatos del navegador. |
| Presupuestos de acceso | Diez intentos por cuenta normalizada/15 min y cien por origen de red/minuto, incluidos accesos correctos. Mapas acotados a mil entradas, expiración, rechazo al llenarse y `Retry-After`. No se confía en IP reenviada por el cliente. |
| Autorización | El servidor deriva usuario/espacio de la sesión y membresía owner; consultas y relaciones se limitan al espacio. IDs enviados por el cliente no conceden acceso. El modelo actual no ofrece colaboración ni administración multiusuario. |
| Validación y persistencia | Validación explícita de tipos, longitudes, enums y campos permitidos, consultas preparadas, claves foráneas y transacciones. Tareas y eventos se guardan atómicamente. Captura y diario disponen de idempotencia; el diario además controla revisión y rechaza conflictos 409. |
| Salidas | React representa texto de usuario sin interpretar HTML almacenado. CSV neutraliza fórmulas. JSON inválido no devuelve fragmentos del cuerpo; los fallos internos no imprimen objetos con datos ni detalles al cliente. Cuerpo API máximo 512 KB. |
| Archivos | `.data`, bases/sidecars, credenciales, claves, dumps y configuración local ignorados por Git. Configuración PostgreSQL local y backups generados 0600, nuevos directorios 0700. Mantener exportaciones JSON privadas dentro de `.data`. Ignorar archivos no limpia secretos ya versionados. |
| PostgreSQL | URL explícita, pool acotado, consultas parametrizadas, schema validado y migraciones con checksum/advisory lock. TLS remoto verifica certificados; no hay fallback SQLite ni creación de una base vacía por error. Locks por workspace coordinan validación/mutación entre procesos. |
| Navegador | CSP con scripts/conexiones/fuentes del propio origen; estilos permiten `unsafe-inline` por la UI actual. `nosniff`, `no-referrer`, DENY de frames, `frame-ancestors 'none'`, `base-uri 'none'`, `form-action 'self'`, Permissions-Policy y HSTS en HTTPS. No se afirma una CSP sin excepciones. |

Parámetros scrypt: [OWASP Password Storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html#scrypt).

### Conexión, privilegios y traslado de datos

`DATABASE_URL` se configura fuera de Git. No registrar URLs, passwords ni errores
crudos del driver. El servidor remoto exige TLS con `rejectUnauthorized:true`,
incluso cuando la URL usa `sslmode=require`; no acepta `sslmode=disable` remoto.
El almacén de confianza es el del runtime. Se admiten `sslmode`, `application_name`
y `channel_binding=disable|prefer|require`; parámetros desconocidos, duplicados o
valores de binding inválidos se rechazan. `require` exige TLS verificado y
SCRAM-SHA-256-PLUS: rechaza SCRAM sin binding, MD5, contraseña en claro y trust antes
de entregar credenciales o permitir consultas. Un server proof inválido tampoco
habilita el cliente. `prefer` negocia PLUS cuando está disponible sobre TLS; `disable`
no exige binding, pero conserva la validación TLS remota. Ausencia del parámetro
conserva el comportamiento anterior. No quitar `require` de una URL para eludir un fallo.

`server/postgres-channel-binding.ts` limita los eventos de autenticación de la
Connection exportada por **pg 8.23.1**; el driver sigue calculando SCRAM y verificando
la prueba del servidor. Este adaptador depende del orden de eventos y la verificación
síncrona de SASLFinal: cualquier actualización de pg exige revisión y repetición de
las pruebas TLS/protocolo. No sustituye una validación real de Neon, que sigue pendiente
hasta conectar allí. Los parámetros de certificados de cliente no se utilizan; no se
ha implementado autenticación mTLS personalizada.

El rol administrativo `focus` de la imagen PostgreSQL local solo prepara recursos
ficticios en loopback. Nuevas configuraciones usan roles/contraseñas diferentes para
`focus_dev`, `focus_demo` y `focus_test`, sin superuser/createdb/createrole/replication/
bypassrls. Se revoca CONNECT público en esas bases; cada rol conecta únicamente a su
base entre las tres. Docker y el administrador conservan acceso privilegiado.

Una demo preexistente conserva su identidad administrativa y `demo-access.json`
hasta una adopción explícita. `local:adopt` ensaya la recuperación y compara cada celda
del backup con el destino (salvo sesiones), verifica rol dedicado sin privilegios ni
membresías adicionales y guarda una selección local privada sin credenciales. El
arranque adoptado usa ese rol, sin semillas ni fallback. Un binding o destino inválido
bloquea el arranque; no se reescriben SQLite ni credenciales anteriores.

Los roles nuevos reciben CRUD sobre tablas existentes sin transferir ownership;
futuras migraciones que alteren esos objetos pueden necesitar administración explícita.
Una instalación duradera requiere separación runtime/migraciones, red restringida,
secretos administrados y backups externos. Producción exige URL explícita y rechaza
modo demo. No hay producción Neon ni Cloud Run verificados; el pool pequeño no
certifica el comportamiento de su proxy/pooling.

La importación SQLite abre la fuente de solo lectura, valida esquema/integridad y
compara celdas del destino en una transacción. Solo admite un destino vacío y revoca
sesiones. Detener todos los escritores y usar una copia consistente cerrada; no es
replicación. Las huellas del archivo principal y WAL detectan cambios observados,
pero no bloquean un escritor ni garantizan un cambio en caliente sin carreras.
El SHA del archivo principal por sí solo no incluye el WAL. Un dato incompatible
con PostgreSQL, como NUL en TEXT, causa rollback sin reescribirlo silenciosamente.
El original y sus herramientas de recuperación permanecen disponibles.

Better Auth queda fuera de esta fase. Antes de incorporarlo: verificar mapeo de
IDs/membresías/propiedad y hashes heredados, plan de revocación/migración de sesiones,
CSRF/origen/cookies y recuperación de cuentas. No cambiar FKs de dominio para
adaptarlas a un proveedor sin un plan de compatibilidad y recuperación probado.

### Origen HTTPS y excepción acotada de Codespaces

`server/runtime.ts` resuelve origen y cookies en cada arranque. Un origen HTTPS no
puede degradar Secure mediante `COOKIE_SECURE=false`. Codespaces exige un origen
HTTPS exacto, configurado explícitamente o derivado de sus variables oficiales;
no admite rutas, credenciales ni dominios comodín como origen.

`server/auth.ts` valida el Host exacto (origen público configurado o endpoint local
con puerto real) y rechaza solicitudes `Sec-Fetch-Site: cross-site`. Cuando hay
Origin, exige el origen canónico salvo la reescritura observada del proxy:

- `CODESPACES=true` y origen público configurado HTTPS.
- Origin exactamente `http://localhost:PORT` o `https://localhost:PORT` y Host
  exactamente `localhost:PORT`, para el puerto configurado.
- `Sec-Fetch-Site: same-origin`; modo ausente, `cors` o `same-origin`, y destino
  ausente o `empty`.

No se confía en `X-Forwarded-Host` ni se aceptan aliases genéricos. Estos headers
no prueban identidad: desafío previo de login, sesión y token CSRF siguen siendo
obligatorios. Los clientes sin Origin no están exentos de esas defensas.
`FOCUS_ORIGIN_REJECTED` registra solo orígenes normalizados/host y procedencia;
no registra cookies, credenciales ni cuerpos. La política está probada con proxy
HTTPS y reescritura interna tanto HTTP como HTTPS, incluido logout.

### Archivos del servidor de desarrollo

`server/development.ts` aplica una barrera antes de las transformaciones Vite:
allowlist de frontend (`src`, `shared`, `node_modules`, `index.html`) y recursos
públicos explícitos `/brand-symbol.svg` y `/fonts/manrope-variable.woff2`.
`publicDir` está desactivado: añadir un archivo a `public` no lo hace accesible
automáticamente en desarrollo. Bloquea backend, agentes, contenedor, bases, logs,
secretos y rutas fuera de alcance, incluyendo `/@fs/`, consultas de importación,
rutas codificadas y escapes mediante symlinks. Solo rutas SPA conocidas reciben
el fallback HTML. No ampliar esta superficie para arreglar un 403.

## Riesgos abiertos y condiciones previas a datos reales

1. **Estado de la cuenta real sin verificar.** No se ha comprobado desde aquí la
   contraseña del propietario, visibilidad del puerto, MFA GitHub, imagen desplegada
   ni custodia de copias. Rotar cualquier contraseña débil o compartida en una
   conversación antes de datos reales. Nunca incluirla en Git o documentación.
2. **Hashes heredados.** Se conserva verificación de scrypt anterior
   N=16384/r=8/p=1 hasta rotar; no hay rehash automático. El menor coste puede
   distinguir temporalmente una cuenta heredada de una inexistente. Rotar elimina
   esa diferencia de parámetros.
3. **Disponibilidad y abuso.** Límites/desafíos son locales al proceso y se reinician
   con él. Un atacante puede causar bloqueo temporal dirigido a una cuenta; detrás
   del proxy varios usuarios comparten origen de red. Una ráfaga puede invalidar
   desafíos anteriores al alcanzar el límite. Para hosting multiinstancia hacen
   falta defensa de borde y presupuestos compartidos, no implementados.
4. **Sesiones y cuentas.** Sin MFA propio, OAuth Google, recuperación por correo,
   lista de dispositivos ni renovación deslizante. La sesión GitHub puede caducar
   por separado. Autorización por espacio probada no equivale a producto multiusuario
   terminado ni evaluación de su despliegue.
5. **Demo y secreto local.** `demo-access.json` contiene la contraseña en claro para
   facilitar pruebas ficticias. En la rotación demo, staging/rename y rollback cubren
   errores ordinarios y concurrencia, pero un corte entre rename y COMMIT puede
   desincronizar JSON y PostgreSQL. No interrumpir; no usar esta herramienta como backup.
   La cuenta personal sin ese JSON rota hash/revocaciones en una transacción PostgreSQL.
6. **Protección y recuperación.** No hay cifrado, backup programado ni envío externo
   automático. Las copias contienen hashes y sesiones; una copia dentro del mismo
   Codespace no protege contra su borrado. Restore conserva la contraseña del
   respaldo y revoca sus sesiones. JSON/CSV de dominio no sustituyen una restauración
   ensayada. El backup JSON PostgreSQL completo incluye secretos; su SHA-256 detecta
   corrupción accidental, no autenticidad frente a quien pueda reescribir archivo y
   checksum. Offline verify no comprueba relaciones; restore sí valida FKs/tipos.
   No ofrece cifrado, firma, `pg_dump` completo del clúster ni PITR.
7. **Concurrencia y escala.** Mismo campo de tarea entre pestañas: última escritura.
   Diario: conflicto explícito por revisión; sin colaboración en tiempo real. Los
   snapshots/históricos completos no están paginados y consumen memoria con volumen.
   Reabrir/relograr hitos sustituye su fecha, sin historial de hitos equivalente a
   eventos de tareas. Evaluar estas limitaciones antes de una importación amplia.
   Si se pierde la conexión al confirmar COMMIT, el cliente puede desconocer si se
   aplicó. Inspeccionar el destino antes de reintentar importaciones/restauraciones;
   el rechazo de destinos ocupados evita una segunda copia sobre registros existentes.
8. **Cobertura y mantenimiento.** Revisión interna acotada, no pentest del alojamiento,
   auditoría completa de todo el historial Git ni certificación. `npm audit` solo
   detecta advisories conocidos al ejecutarlo; no hay mantenimiento automático de
   dependencias. Repetir evaluación sobre el hosting real y considerar revisión
   externa con más usuarios o información especialmente sensible. No se certifican
   dispositivos/Windows reales por pasar Chromium Linux.

El parser de JSON comprimido usa `body-parser` 2.4.0, fijado en el lockfile dentro
del rango compatible de Express 5.1.0, que corrige
[GHSA-27r3-jxmh-p828](https://github.com/advisories/GHSA-27r3-jxmh-p828).
Las pruebas comprueban compresión válida, bytes finales malformados y disponibilidad
posterior del servidor. Zod, sin importadores de aplicación, no se mantiene como
dependencia innecesaria; no queda esa superficie de
[GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5).
Esto no sustituye las auditorías futuras sobre el lockfile y el entorno desplegado.

Antes de pasar del piloto ficticio: actualizar el servidor, proteger GitHub con MFA,
rotar credenciales, separar base personal y desarrollo, configurar proceso compilado
privado/HTTPS, descargar copia cifrada fuera del Codespace y ensayar su recuperación
con histórico. Revisar zona horaria y decidir fuente de cambios antes de importar.
No conectar Notion/importar información privada sin autorización. Para uso estable,
acordar alojamiento con volumen duradero, copias externas y objetivos de recuperación;
no considerar Codespaces preparado para datos reales solo por pruebas locales.
Procedimientos y riesgos de suspensión/borrado en [OPERATIONS.md](OPERATIONS.md).

## Auditorías locales puntuales

### Semgrep OSS reproducible

Entorno POSIX (Linux/Codespaces o WSL), Node 24, Git, curl y [uv/uvx](https://docs.astral.sh/uv/).
Desde la raíz del checkout:

```sh
npm run audit:semgrep
```

[`scripts/security-audit.mjs`](../scripts/security-audit.mjs) instala Semgrep **1.181.0**
en caché temporal fuera del proyecto y descarga únicamente veinte reglas públicas de
[semgrep/semgrep-rules](https://github.com/semgrep/semgrep-rules). La autoridad de selección
es [`.semgrep/rules.lock.json`](../.semgrep/rules.lock.json): commit
`17e31e11ebac99fb7dfe1cd288f7a32151b6f3f9`, IDs, rutas y SHA-256 de cada YAML.
No hay actualizaciones silenciosas: revisar contenido, compatibilidad OSS, licencia,
hashes y resultados al cambiar esa selección. No se añaden paquetes npm ni servicios.

| Riesgo | Reglas seleccionadas |
|---|---|
| SQL/PostgreSQL | `node-postgres-sqli`, `tainted-sql-string` |
| XSS/React/HTML | `react-dangerouslysetinnerhtml`, `insecure-innerhtml`, `raw-html-format` |
| Comandos/código | `spawn-shell-true`, `dangerous-spawn-shell`, `detect-eval-with-expression` |
| Traversal | `express-path-join-resolve-traversal`, `express-res-sendfile` |
| Secretos | `private-key`, `detected-username-and-password-in-uri`, `github-pat`, `github-fine-grained-pat` |
| Criptografía | `detect-pseudoRandomBytes`, `create-de-cipher-no-iv`, `hardcoded-hmac-key` |
| Origen/CORS | `cors-misconfiguration`, `cors-regex-wildcard` |
| Disponibilidad | `detect-redos` |

Se excluyen de la **selección de reglas** estilo, nombres de traducción, compatibilidad
con navegadores antiguos y frameworks no utilizados. No se excluyen archivos de
producción para silenciar resultados. Reglas de `express-session`, JWT o `csurf` no
verifican nuestras sesiones/CSRF propios y no se usan para exigir esos paquetes.

El ejecutor copia el estado de trabajo de archivos versionados y nuevos no ignorados
por Git a un snapshot privado: incluye modificaciones pendientes, pruebas, scripts y
configuración. No abre bases ni archivos ignorados como `.data`/`.env`; un secreto
accidentalmente **versionado** sí entra en el análisis. Excluye únicamente binarios
con bytes NUL, identificados en el resumen; NUL en código/configuración provoca error
en vez de omitirlo. Rechaza symlinks y rutas fuera del checkout.
Pasa los archivos de texto explícitamente al motor: los ignores predeterminados de
Semgrep no ocultan tests. Desactiva `nosemgrep`, métricas, comprobación de versión y
carga de configuraciones remotas; no hereda credenciales de aplicación ni utiliza
motores de pago o sube código. Las peticiones externas descargan herramientas/reglas
públicas; el análisis es local.

Salida: resumen de alcance y directorio privado temporal con `report.json`, `engine.log`
y `scope.json` (commit, hashes de fuentes y manifiesto). El snapshot se elimina al terminar; los informes pueden contener código
o secretos y **no se comparten ni se añaden a Git**. Caché: directorio privado
`focus-semgrep-<uid>` bajo el directorio temporal del sistema. Código de salida: 0 sin
hallazgos ni errores; 1 con hallazgos que requieren triage; 2 si el análisis está
incompleto, falla un hash/versión, falta una herramienta o se omiten archivos de texto.

**Límites:** OSS no demuestra ausencia de vulnerabilidades. La regla PostgreSQL tiene
patrones orientados a CommonJS; imports ESM/`node:`, wrappers y flujos entre archivos
pueden escapar a las reglas. Revisar manualmente los SQL de `Database`/`Domain` y sus
identificadores allowlisted. Ninguna de estas reglas demuestra aislamiento por usuario
o workspace, revocación de sesiones, cookies correctas ni CSRF válido: siguen siendo
necesarias revisión de código y pruebas específicas de API, auth y relaciones entre
espacios. CORS no sustituye autorización. Requisitos de ejecución y revisión pública:
[AGENTS.md](../AGENTS.md#definition-of-done).

Clasificar cada aviso por gravedad, explotabilidad y alcance producción/desarrollo,
separando vulnerabilidad confirmada, falso positivo y endurecimiento. No esconderlos
con exclusiones generales ni aplicar majors automáticos o `npm audit fix --force`.
El aviso `detect-redos` sobre el dominio de forwarding en `server/runtime.ts` exige
revisar la fuente: es configuración confiable de arranque, no entrada HTTP. No es por
sí solo una prueba de DoS remoto; limitar longitudes es endurecimiento pendiente.

### Secretos e historial con Gitleaks

Complementa Semgrep con [Gitleaks OSS](https://github.com/gitleaks/gitleaks/releases)
(versionar la herramienta; referencia reproducible 8.24.3), instalado fuera del
proyecto desde la release oficial y verificando su SHA-256. Sobre un snapshot privado
de archivos versionados y sus cambios, y sobre el historial local:

```sh
# SOURCE es el snapshot privado revisado; REPORT_DIR es un directorio privado fuera de Git.
gitleaks dir --redact=100 --ignore-gitleaks-allow --no-banner \
  --report-format=json --report-path="$REPORT_DIR/current.json" "$SOURCE"
gitleaks git --log-opts='--all --full-history' --redact=100 --ignore-gitleaks-allow \
  --no-banner --report-format=json --report-path="$REPORT_DIR/history.json" .
```

Gitleaks devuelve 1 con secretos detectados; otros errores no son un análisis limpio.
Comprobar si el clon es shallow y qué refs están disponibles: `--all` cubre historial
local alcanzable, no commits borrados/inaccesibles del servidor. No imprimir valores
ni compartir reportes sin revisarlos. Un secreto real exige revocación/rotación; borrar
la línea o ignorar el archivo no lo invalida ni limpia el historial.

## Evidencia reproducible y alcance

Los comandos de validación están en [OPERATIONS.md](OPERATIONS.md#desarrollo-reinicio-y-comprobaciones).
Las suites automatizadas son la evidencia mantenida; los resultados de cada ejecución
se comunican en la revisión de ese cambio, sin conservar diarios de pruebas.

| Referencia | Qué comprueba |
|---|---|
| [tests/channel-binding.test.ts](../tests/channel-binding.test.ts) | PostgreSQL TLS real con PLUS, certificado no confiable y rechazo de degradaciones/ReadyForQuery o prueba SCRAM inválida. |
| [tests/local-adoption.test.ts](../tests/local-adoption.test.ts) | Comparación de backup/destino, permisos del binding, rechazo de cambios de identidad y arranque adoptado sin bootstrap. |
| [tests/recovery-rehearsal.test.ts](../tests/recovery-rehearsal.test.ts) | Restauración aislada, fidelidad completa, sesiones solo del clon revocadas y limpieza del esquema propio. |
| [tests/compressed-request.test.ts](../tests/compressed-request.test.ts) | JSON comprimido válido y malformado no derriba el parser previo a autenticación. |
| [tests/postgres-only.test.ts](../tests/postgres-only.test.ts) | Arranque sin URL/servidor disponible falla; desarrollo, compilado, demo y backup/restore funcionan con `node:sqlite` deshabilitado; guardas de producción. |
| [tests/api.test.ts](../tests/api.test.ts) | Autenticación/logout, CSRF/origen, IDs/relaciones entre espacios, eventos y exportaciones. |
| [tests/security-hardening.test.ts](../tests/security-hardening.test.ts) | Cookies, Secure, origen/Host/proxy negativo, caducidad, límites, hashes y carreras de rotación, errores sin datos privados. |
| [tests/password-cli.test.ts](../tests/password-cli.test.ts) | Rotación, revocación, ausencia de credenciales en salida, no creación de base, metadatos/symlinks/concurrencia. |
| [tests/dev.spec.ts](../tests/dev.spec.ts) | Archivos protegidos, symlinks/rutas codificadas, HMR y recursos de marca permitidos. |
| [tests/proxy.spec.ts](../tests/proxy.spec.ts) | Navegador HTTPS con Origin reescrito HTTP/HTTPS, sesión/logout y rechazo cross-site. |
| [tests/recovery.test.ts](../tests/recovery.test.ts) | Recuperación SQLite heredada: WAL confirmado, integridad/esquema/FK, no sobrescritura y sesiones revocadas. |
| [tests/postgres-migration.test.ts](../tests/postgres-migration.test.ts) | Importación SQLite 001/002, fidelidad, rollback, backup completo y recuperación PostgreSQL a destino vacío. |
| [tests/daily-readiness.spec.ts](../tests/daily-readiness.spec.ts) | Persistencia tras recarga/login/reinicio real y backup/restore aislado. |
| [tests/language.test.ts](../tests/language.test.ts) | Migración aditiva, aislamiento de preferencia y compatibilidad de copias 001/002. |

Estas pruebas usan datos ficticios y no inspeccionan la base del propietario.
Una revisión favorable de código/tests no verifica por sí sola la configuración
real de GitHub, el almacenamiento externo, el futuro proveedor ni ausencia de
vulnerabilidades desconocidas.
