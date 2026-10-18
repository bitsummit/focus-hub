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
SQLite y el código. El login web no protege un equipo comprometido. SQLite y sus
copias **no están cifradas por la app**. Los controles de archivos de Vite reducen
exposición; no convierten desarrollo en un servidor de producción.

## Controles implementados

| Área | Control actual y límite |
|---|---|
| Alta y administración | Sin registro público ni recuperación por correo. Creación inicial/rotación local por CLI; correo normalizado, contraseña nueva de 12–256 caracteres. No se envían correos. |
| Contraseñas | Nuevos hashes versionados scrypt N=32768, r=8, p=3, sal aleatoria y comparación de tiempo constante. Derivación online asíncrona, máximo dos verificaciones concurrentes; saturación devuelve 503 y `Retry-After`. El hash no se exporta al snapshot web. |
| Sesión | Token aleatorio de 256 bits, almacenado como SHA-256 en SQLite. Cookie HttpOnly/SameSite Strict, Path=/; en HTTPS `__Host-focus_session`, Secure y sin Domain. Rechazo de cookies duplicadas y limpieza de la cookie antigua. Caducidad fija de siete días, sin renovación deslizante. Logout revoca la sesión; contraseña nueva revoca todas las de la cuenta. |
| Carrera login/rotación | Antes de emitir sesión se comprueba transaccionalmente que sigue vigente el hash verificado; un login pendiente no restaura sesiones de una contraseña revocada. |
| Login CSRF | `GET /api/session/challenge` emite desafío de un uso, diez minutos, cookie HttpOnly/SameSite Strict y token para `X-Login-CSRF`. Cookie prefijada `__Host-` y Secure en HTTPS; login solo JSON, con desafío válido y respuesta sin caché. |
| CSRF autenticado | Escrituras, incluido logout, requieren cookie de sesión válida y `X-CSRF-Token` emitido por el servidor. Validación adicional de origen/Host; no se sustituye CSRF por metadatos del navegador. |
| Presupuestos de acceso | Diez intentos por cuenta normalizada/15 min y cien por origen de red/minuto, incluidos accesos correctos. Mapas acotados a mil entradas, expiración, rechazo al llenarse y `Retry-After`. No se confía en IP reenviada por el cliente. |
| Autorización | El servidor deriva usuario/espacio de la sesión y membresía owner; consultas y relaciones se limitan al espacio. IDs enviados por el cliente no conceden acceso. El modelo actual no ofrece colaboración ni administración multiusuario. |
| Validación y persistencia | Validación explícita de tipos, longitudes, enums y campos permitidos, consultas preparadas, claves foráneas y transacciones. Tareas y eventos se guardan atómicamente. Captura y diario disponen de idempotencia; el diario además controla revisión y rechaza conflictos 409. |
| Salidas | React representa texto de usuario sin interpretar HTML almacenado. CSV neutraliza fórmulas. JSON inválido no devuelve fragmentos del cuerpo; los fallos internos no imprimen objetos con datos ni detalles al cliente. Cuerpo API máximo 512 KB. |
| Archivos | `.data`, bases/sidecars, credenciales, claves y configuración local ignorados por Git. SQLite/WAL/SHM privados 0600, nuevos directorios 0700. Ignorar archivos no limpia secretos que ya hubieran sido versionados. |
| Navegador | CSP con scripts/conexiones/fuentes del propio origen; estilos permiten `unsafe-inline` por la UI actual. `nosniff`, `no-referrer`, DENY de frames, `frame-ancestors 'none'`, `base-uri 'none'`, `form-action 'self'`, Permissions-Policy y HSTS en HTTPS. No se afirma una CSP sin excepciones. |

Parámetros scrypt: [OWASP Password Storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html#scrypt).

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
   desincronizar JSON y SQLite. No interrumpir; no usar esta herramienta como backup.
   La cuenta personal sin ese JSON rota hash/revocaciones en una transacción SQLite.
6. **Protección y recuperación.** No hay cifrado, backup programado ni envío externo
   automático. Las copias contienen hashes y sesiones; una copia dentro del mismo
   Codespace no protege contra su borrado. Restore conserva la contraseña del
   respaldo y revoca sus sesiones. JSON/CSV no sustituyen una restauración ensayada.
7. **Concurrencia y escala.** Mismo campo de tarea entre pestañas: última escritura.
   Diario: conflicto explícito por revisión; sin colaboración en tiempo real. Los
   snapshots/históricos completos no están paginados y consumen memoria con volumen.
   Reabrir/relograr hitos sustituye su fecha, sin historial de hitos equivalente a
   eventos de tareas. Evaluar estas limitaciones antes de una importación amplia.
8. **Cobertura y mantenimiento.** Revisión interna acotada, no pentest del alojamiento,
   auditoría completa de todo el historial Git ni certificación. `npm audit` solo
   detecta advisories conocidos al ejecutarlo; no hay mantenimiento automático de
   dependencias. Repetir evaluación sobre el hosting real y considerar revisión
   externa con más usuarios o información especialmente sensible. No se certifican
   dispositivos/Windows reales por pasar Chromium Linux.

Antes de pasar del piloto ficticio: actualizar el servidor, proteger GitHub con MFA,
rotar credenciales, separar base personal y desarrollo, configurar proceso compilado
privado/HTTPS, descargar copia cifrada fuera del Codespace y ensayar su recuperación
con histórico. Revisar zona horaria y decidir fuente de cambios antes de importar.
No conectar Notion/importar información privada sin autorización. Para uso estable,
acordar alojamiento con volumen duradero, copias externas y objetivos de recuperación;
no considerar Codespaces preparado para datos reales solo por pruebas locales.
Procedimientos y riesgos de suspensión/borrado en [OPERATIONS.md](OPERATIONS.md).

## Evidencia reproducible y alcance

Los comandos de validación están en [OPERATIONS.md](OPERATIONS.md#desarrollo-reinicio-y-comprobaciones).
Las suites automatizadas son la evidencia mantenida; los resultados de cada ejecución
se comunican en la revisión de ese cambio, sin conservar diarios de pruebas.

| Referencia | Qué comprueba |
|---|---|
| [tests/api.test.ts](../tests/api.test.ts) | Autenticación/logout, CSRF/origen, IDs/relaciones entre espacios, eventos y exportaciones. |
| [tests/security-hardening.test.ts](../tests/security-hardening.test.ts) | Cookies, Secure, origen/Host/proxy negativo, caducidad, límites, hashes y carreras de rotación, errores sin datos privados. |
| [tests/password-cli.test.ts](../tests/password-cli.test.ts) | Rotación, revocación, ausencia de credenciales en salida, no creación de base, metadatos/symlinks/concurrencia. |
| [tests/dev.spec.ts](../tests/dev.spec.ts) | Archivos protegidos, symlinks/rutas codificadas, HMR y recursos de marca permitidos. |
| [tests/proxy.spec.ts](../tests/proxy.spec.ts) | Navegador HTTPS con Origin reescrito HTTP/HTTPS, sesión/logout y rechazo cross-site. |
| [tests/recovery.test.ts](../tests/recovery.test.ts) | WAL confirmado, integridad/esquema/FK, no sobrescritura, procesos activos y restauración con sesiones revocadas. |
| [tests/daily-readiness.spec.ts](../tests/daily-readiness.spec.ts) | Persistencia tras recarga/login/reinicio real y backup/restore aislado. |
| [tests/language.test.ts](../tests/language.test.ts) | Migración aditiva, aislamiento de preferencia y compatibilidad de copias 001/002. |

Estas pruebas usan datos ficticios y no inspeccionan la base del propietario.
Una revisión favorable de código/tests no verifica por sí sola la configuración
real de GitHub, el almacenamiento externo, el futuro proveedor ni ausencia de
vulnerabilidades desconocidas.
