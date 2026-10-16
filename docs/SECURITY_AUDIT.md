# Auditoría interna y endurecimiento · 16 de octubre de 2026

## Conclusión y alcance

Primera revisión interna de Focus Hub, partiendo de `0e37917`. Se revisaron código,
configuración y dependencias y se ejecutaron pruebas con datos ficticios aislados.
Las correcciones permiten continuar la validación privada. No constituyen una
certificación, una auditoría externa ni autorización para publicar el servicio.
No se revisó ni modificó la base del Codespace personal del usuario, ni se importó
Notion. La aplicación permanece en la arquitectura Node/Express/SQLite existente.

No se encontró una vía de SQL injection, acceso entre espacios, asignación masiva
o ejecución de HTML almacenado en los flujos revisados. Esto describe el alcance
de la revisión y sus pruebas, no una garantía de ausencia de vulnerabilidades.

Antes de incorporar datos reales: aplicar la actualización, cambiar la contraseña
de demo, separar el espacio personal y completar copias y restauración (paso 3).
Mantener el puerto privado y la cuenta GitHub protegida, preferiblemente con MFA.

## Modelo de amenaza

- El forwarding privado de GitHub es la primera barrera; el login de Focus Hub es
  una segunda barrera. No se cambió la visibilidad del puerto ni se aprovisionó PRO.
- Se consideran peticiones hostiles de alguien que puede alcanzar ese puerto,
  sitios de terceros, identificadores manipulados y un usuario autenticado que
  intenta acceder a otro espacio o consumir recursos excesivos.
- El usuario del sistema que controla el Codespace, su terminal o el repositorio
  puede leer/modificar SQLite y el servidor. El login web no protege frente a un
  equipo o una cuenta GitHub comprometidos. SQLite no está cifrada por la app.
- Vite sirve código de desarrollo: no debe utilizarse como servidor de producción.
  Las defensas de archivos reducen su exposición, sin convertirlo en un hosting PRO.

## Equipo y método

Se usaron agentes nativos reales, transmitiéndoles las instrucciones de los perfiles
versionados; este runtime no ofrece selector automático de roles personalizados.

| Agente | Trabajo real |
|---|---|
| `security_review` | Revisión de autenticación, sesiones, origen/proxy y archivos; segunda revisión de las correcciones |
| `data_security_review` | Revisión de autorización, SQL, validación, salidas e histórico; después, corrección y pruebas de estadísticas |
| `security_qa` | Auditoría de dependencias y regresiones aisladas de autenticación y seguridad |
| `password_cli` | Herramienta local de rotación y pruebas de subprocessos |
| Coordinador | Contratos, auth, Vite, dependencias, integración, navegador e informe |

Los agentes revisores no modificaron archivos mientras tenían alcance de solo
lectura. La implementación de estadísticas se asignó posteriormente de forma
expresa. Los archivos compartidos permanecieron bajo control del coordinador.

## Hallazgos y correcciones

La gravedad depende de los requisitos de explotación indicados; no se ha
establecido que alguien haya explotado estos problemas.

| ID | Gravedad / condición | Hallazgo y corrección |
|---|---|---|
| SEC-01 | Alta según advisories; Vite activo en DEV | Vite 7.1.9 tenía seis avisos conocidos. Actualizado a 7.3.7 con lockfile e integridad npm. Algunos avisos eran exclusivos de Windows; otros afectaban lectura de archivos/WebSocket también en Linux. |
| SEC-02 | Alta condicional: DB colocada en raíz y acceso al puerto | `FOCUS_DB` permitía una DB fuera de `.data`, sin exclusión general de SQLite. Se limita el acceso de Vite a `src`, `shared`, `node_modules` e `index.html`; se bloquean bases, sidecars, claves y logs y se desactiva el directorio público no utilizado. |
| SEC-03 | Baja en la configuración actual | Los patrones `.codex/**` y `.agents/**` no coincidían con rutas absolutas. Se corrigieron y se añadió bloqueo de configuración del contenedor y código del backend. Se comprueban rutas directas, `/@fs/` y consultas `?raw`/`?import`. El fallback HTML ya no devuelve 200 para solicitudes de archivos ajenos a las rutas SPA. |
| SEC-04 | Media, disponibilidad | El límite por IP confundía a todos los visitantes detrás del proxy. Ahora hay presupuestos por cuenta normalizada (10/15 min) y por origen de red (100/min), mapas acotados, expiración, rechazo al llenarse y `Retry-After`. No se confía en IP reenviada por el cliente. |
| SEC-05 | Media, operación | No había rotación con revocación global por cuenta. `npm run password` cambia el hash y revoca todas sus sesiones en una transacción, sin alterar tareas ni otras cuentas. No se ha ejecutado contra la cuenta real. |
| SEC-06 | Baja, endurecimiento | Cookies HTTPS sin prefijo y aceptación de duplicados. Ahora se usa `__Host-focus_session`, sin Domain, Secure/HttpOnly/SameSite Strict; se rechazan duplicados y se limpian cookies antiguas al acceder/salir. Sesiones antiguas requieren volver a iniciar sesión. |
| SEC-07 | Baja, configuración/defensa adicional | Se impide desactivar Secure en un origen HTTPS, se comprueba Host y se rechazan orígenes no canónicos. Se conserva únicamente la excepción exacta del proxy observada y probada, junto al desafío de login y CSRF de sesión. |
| SEC-08 | Media, disponibilidad autenticada | Estadísticas repetían conversiones temporales por cada día y evento. Se agrupan una vez por día local: O(eventos + días). Se verificaron 3.000 tareas/12.000 eventos y tres años, manteniendo DST y métricas históricas. |
| SEC-09 | Endurecimiento de secretos y almacenamiento | Los errores JSON no devuelven fragmentos del cuerpo; los fallos internos no imprimen objetos con datos. Se fuerzan permisos 0600 de SQLite/WAL/SHM y se añaden Permissions-Policy y HSTS para HTTPS. |
| SEC-10 | Endurecimiento del hash de contraseña | Nuevos hashes versionados scrypt N=32768/r=8/p=3 (~32 MiB), una configuración recomendada por OWASP. Verificación online asíncrona y máximo dos derivaciones simultáneas, con 503 y Retry-After al saturarse. Se conserva lectura de hashes antiguos; para actualizarlos debe rotarse la contraseña. |
| SEC-11 | Regresión evitada durante la corrección | La rotación podía ocurrir mientras esperaba una verificación asíncrona. Antes de crear la sesión se comprueba dentro de transacción que el hash sigue vigente. Una prueba determinista confirma que el acceso pendiente antiguo no recrea sesiones revocadas. |

Referencia de parámetros: [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html#scrypt).
La comprobación local de un hash nuevo rondó 230 ms; no es una garantía de latencia
en otro equipo. El límite de concurrencia evita una cola ilimitada de derivaciones.
La creación/rotación administrativa es síncrona y se ejecuta fuera del servidor HTTP.

### Dependencias

Advisories detectados en la versión inicial de Vite:

- GHSA-93m4-6634-74q7
- GHSA-4w7w-66w2-5vf9
- GHSA-v2wj-q39q-566r
- GHSA-p9ff-h696-f583
- GHSA-v6wh-96g9-6wx3
- GHSA-fx2h-pf6j-xcff

`npm audit` tras la actualización: **0 avisos conocidos**, incluidas dependencias
DEV. Esto no cubre vulnerabilidades aún desconocidas ni configura mantenimiento
automático de dependencias. Las pruebas usan Node 24.19.0 y Chromium de este entorno.

## Evidencia reproducible

```sh
npm ci
npm test
npm run build
npm run test:e2e
npm audit
```

No ejecutar builds durante pruebas de navegador ni dos suites en el puerto 4173.
La suite crea fixtures temporales, no utiliza bases ni credenciales personales.

- Backend, dominio, CLI y seguridad: 38 pruebas, sin omisiones.
- Navegador: 7 recorridos, incluidos HTTPS con reescritura de proxy, HMR real,
  captura persistente, exportaciones, aislamiento de archivos y móvil.
- Build: TypeScript y compilación Vite.
- Instalación reproducible con `npm ci` y arranque/repetición del servicio
  gestionado con la demo existente: login, persistencia y referencias correctos.
- La aplicación de esta actualización al Codespace personal y su visibilidad
  Private deben comprobarse allí; no se afirma haber probado esa cuenta a distancia.

El caso de navegador ampliado detectó inicialmente un módulo 200 que exportaba
la URL de una ruta privada con `?import`, sin leer su contenido. Se añadió una
barrera antes de las transformaciones de Vite: verifica rutas normalizadas y
destinos de symlinks contra su allowlist/denylist y devuelve 403. También se
limitó el fallback HTML a rutas SPA conocidas. Las pruebas incluyen rutas
codificadas y symlinks; no se relajaron las aserciones de bloqueo.

## Aplicar en el Codespace existente

Desde la carpeta del proyecto, en su terminal:

```sh
git pull --ff-only
node .devcontainer/service.mjs stop
npm ci
bash .devcontainer/start.sh
```

No hace falta reconstruir el contenedor. Este cambio sí necesita reinstalar las
dependencias y reiniciar porque actualiza Vite y el backend. Los futuros cambios
solo de frontend mantienen HMR. La actualización conserva la base y el archivo de
acceso; no modifica automáticamente la contraseña. Vuelve a iniciar sesión tras
el cambio de cookie.

Para sustituir la contraseña de la demo y revocar sus sesiones:

```sh
FOCUS_DB=.data/demo.sqlite npm run password
```

Introduce su correo y una contraseña nueva de 12–256 caracteres dos veces. La
entrada de contraseña queda oculta. Usa una frase larga y única de un gestor de
contraseñas, nunca `123456`. No pegues la contraseña en el chat ni la subas a Git.
El archivo local `demo-access.json` se sincroniza sin imprimirla; el smoke test
seguirá funcionando. No interrumpas la rotación.

Para una cuenta personal distinta de la demo, usa `FOCUS_DB` con su base existente.
El comando rechaza bases inexistentes; no crea otra cuenta. No hay recuperación
por correo ni registro público. Quien controla la terminal puede administrar
las credenciales: protege el acceso a GitHub/Codespaces.

## Límites y puertas de paso pendientes

1. **Contraseña y despliegue reales:** no se puede certificar desde aquí que la
   cuenta del usuario haya dejado de usar `123456`. Debe rotarla allí. Los hashes
   heredados siguen verificándose hasta rotación; no hay conversión automática.
   Su menor coste puede permitir distinguir temporalmente una cuenta heredada de
   una inexistente; la rotación elimina esa diferencia de parámetros.
2. **Antes de importar datos:** separar demo/espacio personal, respaldar fuera del
   Codespace, proteger los respaldos y demostrar restauración, incluido histórico.
   Exportar JSON no sustituye por sí solo una restauración probada.
3. **DEV y piloto personal:** usar datos ficticios en Vite. Para el piloto con datos
   reales, preparar un proceso compilado privado y una base personal independiente;
   conservar desarrollo/pruebas en otra base. No mezclar pruebas destructivas.
4. **Límites de acceso:** son locales al proceso, se reinician con él y no constituyen
   protección distribuida. La limitación por cuenta incluye accesos correctos y
   permite bloqueo temporal dirigido. PRO necesitará defensa de borde y presupuesto
   compartido si hay múltiples instancias. El endpoint de desafíos tiene memoria
   acotada, pero una ráfaga puede invalidar desafíos anteriores.
5. **Sesiones:** duran siete días como máximo, sin renovación deslizante. Hay logout
   individual y revocación mediante cambio de contraseña; aún no hay panel de
   dispositivos, MFA propio ni recuperación por correo. Ampliarlas a 30 días no
   forma parte de esta fase. GitHub puede pedir su propia autenticación aparte.
6. **Rotación de demo:** SQLite y el JSON no comparten transacción ante un apagado
   brusco. Hay staging/rename y rollback para errores ordinarios y concurrencia;
   un corte entre rename y COMMIT puede desincronizar metadatos. No interrumpir el
   comando; esta herramienta no es un mecanismo de backup. En la cuenta personal
   sin archivo demo la rotación y revocación son solo una transacción SQLite.
7. **Escala e integridad del producto:** snapshots/histórico no están paginados;
   volúmenes grandes consumen memoria. Reabrir/relograr un hito sustituye su fecha
   sin un historial de hitos (las tareas sí conservan eventos). Ediciones del mismo
   campo de tarea entre pestañas usan última escritura; el diario tiene revisión.
   Resolver/revisar estas limitaciones antes del ensayo de importación.
8. **Cobertura:** revisión interna acotada y fixtures locales, no pentest del
   alojamiento, auditoría de todo el historial Git ni certificación. No se probaron
   ataques sobre servicios externos, cuentas reales ni un Windows real. Repetir
   la evaluación sobre el futuro hosting PRO y considerar revisión externa si
   aparecen otros usuarios o información especialmente sensible.

## Continuación del plan

1. Auditoría/endurecimiento: implementación y evidencia de esta entrega; aplicación
   y rotación en el Codespace del usuario pendientes.
2. Ajustes UI: siguientes cambios concretos a definir con el usuario.
3. Separación de datos, copia y restauración: puerta previa a Notion.
4. Ensayo de importación: solo con exportación proporcionada y autorización, sin
   conectar Notion automáticamente y sin inventar fechas desconocidas.
5. Piloto privado: elegir una fuente de cambios y conservar Notion como referencia.
6. PRO: alojamiento estable, secretos/bases independientes y revisión del despliegue.
