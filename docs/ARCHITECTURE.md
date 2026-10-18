# Focus. — Arquitectura

Referencia técnica del sistema actual. Las reglas funcionales están en
[Producto](PRODUCT.md); las garantías y riesgos de seguridad, en
[Seguridad](SECURITY.md); ejecución y recuperación, en [Operaciones](OPERATIONS.md).

## Stack y límites de proceso

React 19/TypeScript renderiza una SPA, Vite 7 compila y sirve el frontend durante
el desarrollo. Express 5 sobre Node.js 24 ofrece la API y el frontend desde un
único servidor HTTP en loopback. SQLite usa `node:sqlite` y un archivo local.
No hay servicios Sites/D1, proveedor OAuth ni adaptador remoto implementados.
No se necesita un segundo puerto para frontend o WebSocket.

```text
Navegador (React, preferencias de presentación)
    │ HTTP /api + frontend; WebSocket HMR solo en desarrollo
    │ Codespaces: HTTPS + control de acceso de GitHub → loopback
Express → autenticación / CSRF / autorización → Domain → SQLite + WAL
    └─ producción compilada: dist/ | desarrollo: Vite middleware
```

El lenguaje, tipos y esquema SQL facilitan una migración futura, pero no existe
un backend intercambiable ya validado para D1. Una migración exige autorización
y verificar transacciones, identidad, persistencia y despliegue del nuevo destino.

## Módulos y responsabilidades

| Ubicación | Responsabilidad |
|---|---|
| [`src/main.tsx`](../src/main.tsx) | Bootstrap React y entrada explícita de estilos |
| [`src/app/App.tsx`](../src/app/App.tsx) | Sesión, peticiones, snapshot canónico, sincronización, filtros persistentes durante navegación y shell |
| [`src/app/navigation.ts`](../src/app/navigation.ts), [`src/app/types.ts`](../src/app/types.ts) | Rutas/History API y contrato `WorkspaceProps` compartido por páginas/componentes |
| [`src/pages/`](../src/pages/) | Login y las siete secciones; diario agrupa feed/editor, proyectos agrupa objetivos y detalle |
| [`src/lib/dates.ts`](../src/lib/dates.ts), [`src/lib/tasks.ts`](../src/lib/tasks.ts) | Calendario/formato localizado, IDs de captura y presentación del historial |
| [`src/components/`](../src/components/) | Tabla/Kanban, captura móvil, confirmación de proyecto, `BrandLogo`, editor `TaskDialog`, formularios estratégicos, filtros y UI compartida |
| [`src/task-filters.ts`](../src/task-filters.ts) | Predicados de chips y filtros combinados |
| [`src/i18n.ts`](../src/i18n.ts), [`src/locales/en.json`](../src/locales/en.json) | Traducción de interfaz y formato localizado |
| [`src/styles/index.ts`](../src/styles/index.ts) | Orden explícito de la cascada: base, marca, componentes y refinamientos |
| [`src/brand.ts`](../src/brand.ts), [`src/brand.css`](../src/brand.css) | Identidad compartida; valores en [Marca](BRAND_IDENTITY.md) |
| [`shared/contracts.ts`](../shared/contracts.ts) | Tipos de filas, `Snapshot`, `Session`, captura, diario y analytics |
| [`server/app.ts`](../server/app.ts) | Rutas Express, headers, validación HTTP, errores y frontend |
| [`server/auth.ts`](../server/auth.ts), [`server/login-challenge.ts`](../server/login-challenge.ts), [`server/login-limiter.ts`](../server/login-limiter.ts) | Credenciales, sesiones, autorización, CSRF, origen y presupuestos de login |
| [`server/domain.ts`](../server/domain.ts) | Validación del dominio, SQL preparado, eventos, idempotencia, diario, foco, métricas y exportación |
| [`server/db.ts`](../server/db.ts), [`migrations/`](../migrations/) | Apertura SQLite, transacciones y migraciones aditivas |
| [`server/calendar.ts`](../server/calendar.ts) | Fechas locales, zona IANA y límites UTC mediante Temporal |
| [`server/runtime.ts`](../server/runtime.ts), [`server/index.ts`](../server/index.ts), [`server/development.ts`](../server/development.ts) | Configuración de origen, servidor y frontera de archivos de Vite |
| [`server/owner.ts`](../server/owner.ts), [`server/password.ts`](../server/password.ts), [`server/demo.ts`](../server/demo.ts) | Administración local y demo ficticia |
| [`server/recovery.ts`](../server/recovery.ts), [`scripts/database.ts`](../scripts/database.ts) | Snapshot SQLite, verificación y recuperación sin sobrescribir destinos |
| [`.devcontainer/`](../.devcontainer/) | Instalación y ciclo de vida del proceso administrado en Codespaces |
| [`tests/`](../tests/), [`playwright.config.ts`](../playwright.config.ts) | Fixtures aislados y comprobaciones unitarias, HTTP y Chromium |

No hay router ni gestor global de estado externo: la SPA usa History API y estado
React. `App` conserva la propiedad de sesión, snapshot, mutaciones, captura global,
filtros y vista seleccionada para no reiniciarlos al desmontar una página. Las
páginas reciben el mismo `WorkspaceProps` canónico; no guardan otra copia de tareas.
Ninguna página importa `App`; los tipos compartidos no dependen del runtime React.
Los componentes de presentación reutilizados son `WorkspaceUI` y `WorkspaceCards`;
el editor de entidades estratégicas permanece separado del editor de tareas.

La entrada de estilos se importa antes de `App` y fija el orden independientemente
del grafo de páginas: base → marca → tabla/confirmación/captura → refinamientos.
Los componentes conservan sus imports CSS para uso autónomo; Vite deduplica esos
módulos ya registrados. No cambiar este orden sin comparar el resultado visual y
los estilos calculados en temas y resoluciones representativos.

## Propiedad de la cascada CSS

[`src/styles/index.ts`](../src/styles/index.ts) es el registro de carga. La fachada
[`src/styles.css`](../src/styles.css) importa, en orden, los fundamentos, shell,
dashboard, controles/tareas, editor/diario, proyectos/avances, ajustes/login,
responsive y consumidores de temas. Los estilos autónomos de componentes se cargan
a continuación. [`styles/refinements.css`](../src/styles/refinements.css) fija la
segunda frontera: tokens, interfaz canónica, feed del diario, captura y login.

| Responsabilidad | Fuente |
|---|---|
| Identidad oficial | [`brand.css`](../src/brand.css); única autoridad de tokens de marca |
| Paleta neutra, estados, claro/oscuro/system y aliases del workspace | [`styles/tokens.css`](../src/styles/tokens.css) |
| Reset, tipografía base y accesibilidad global | [`styles/foundations.css`](../src/styles/foundations.css) |
| Layout de secciones y controles | Archivos de ámbito en [`styles/`](../src/styles/), con orden en la fachada base |
| Contraste, estados y controles compartidos vigentes | [`styles/interface.css`](../src/styles/interface.css) |
| Feed/navegación temporal, halo de captura y composición de login | `styles/journal-feed.css`, `styles/capture.css`, `styles/login.css` |
| Tabla/Kanban, captura inferior y confirmación de proyecto | CSS junto al componente en [`components/`](../src/components/) |

Los valores base y los aliases del workspace no son intercambiables sin verificar
sus consumidores y la herencia. Los breakpoints también tienen funciones distintas:
navegación móvil hasta 650 px, tabla/lista y Kanban hasta 767 px y rail intermedio
en su rango propio. No unificar esos límites como si fueran duplicados.

La organización conserva especificidad y secuencia del CSS necesario; aún existen
selectores de alta especificidad y `!important` para consumidores heredados,
controles táctiles y movimiento reducido. No retirarlos por una búsqueda estática.
Editar el ámbito propietario y las reglas canónicas, sin añadir otra hoja temporal
de overrides. Cualquier consolidación adicional exige revisar estados condicionales,
responsive y ambos temas, comparando estilos calculados y capturas con fixtures
idénticos. El procedimiento reproducible está en [Operaciones](OPERATIONS.md#capturas-reproducibles).

## Persistencia y consistencia

Las filas canónicas incluyen usuarios, workspaces y miembros; tareas, proyectos,
objetivos e hitos; eventos de tarea; entradas y bloques de diario; selecciones de
foco; sesiones y registros de idempotencia. Las relaciones usan IDs estables y
`workspace_id`; una referencia del diario apunta a la tarea, no a una copia.
Las subtareas son tareas con `parent_task_id`, no otra entidad de checklist.

`openDatabase` habilita WAL, claves foráneas y `busy_timeout=5000`. Serializa la
comprobación de migraciones con `BEGIN IMMEDIATE`: aplica el esquema inicial
idempotente y añade `users.language` cuando falta. No hay un runner general de
versiones ni downgrades. Nuevas migraciones deben conservar datos e integrarse
explícitamente en esta apertura; no editar retroactivamente el esquema publicado
para simular una migración. Permisos de archivos y recuperación: [Seguridad](SECURITY.md).

Captura, eventos y referencia de diario se escriben atómicamente. Los IDs de
petición deduplican reintentos de creación; las revisiones de diario rechazan
ediciones obsoletas con 409. La UI conserva el borrador ante error. Las mutaciones
devuelven un `Snapshot` completo. El cliente bloquea envíos duplicados de captura
y cambios simultáneos sobre la misma tarea dentro de esa pestaña; no existe una
serialización global de peticiones ni protección general contra snapshots obsoletos.
Refresca al recuperar foco y cada 20 segundos.
No hay sincronización push entre dispositivos ni cola offline. Otros cambios
concurrentes usan la última escritura aceptada; no hay bloqueo optimista general.

Eventos y timestamps se almacenan en UTC; fechas de diario y foco son fechas de
calendario local. Vencimiento/seguimiento admiten fecha local o instante explícito
en el contrato; los controles habituales capturan una fecha local. Temporal calcula límites según la zona IANA y
el inicio de semana del usuario, incluyendo DST. No convertir fechas locales a
medianoche UTC por conveniencia. Analytics agrupa eventos una vez por día local
antes de construir la serie, evitando un barrido completo por cada día.
Definiciones de métricas: [Producto](PRODUCT.md).

## Contratos HTTP

`/api` valida Host/origen antes de leer JSON (límite 512 KB). Login emite una
sesión; el middleware posterior deriva usuario/workspace de la membresía confiable,
no de parámetros del cliente. Las escrituras autenticadas necesitan `X-CSRF-Token`.
El despliegue HTTPS determina cookies seguras; detalles y excepción acotada del
proxy Codespaces en [Seguridad](SECURITY.md).

| Endpoint | Contrato |
|---|---|
| `GET /api/health` | Estado básico; no prueba login ni persistencia |
| `GET /api/session/challenge`, `POST /api/session` | Desafío de login; credenciales JSON y desafío de un uso |
| `GET /api/session`, `DELETE /api/session` | Sesión + `csrfToken`; revocación y borrado de cookie |
| `GET /api/state` | `Snapshot` autorizado completo |
| `POST /api/tasks`, `PATCH/DELETE /api/tasks/:id` | Captura con `request_id`, edición o borrado lógico |
| `GET /api/tasks/:id/events` | Eventos de una tarea accesible |
| `POST /api/<tipo>`, `PATCH /api/<tipo>/:id` (`projects`, `goals`, `milestones`) | Creación/edición de entidades estratégicas |
| `GET /api/journals/:date`, `POST /api/journals/:date/blocks` | Diario local; captura con `revision` y `request_id` |
| `PATCH/DELETE /api/blocks/:id` | Edición/eliminación de bloque con revisión |
| `PUT /api/focus/:type/:date` | Reemplaza selección ordenada `{task_ids}` diaria/semanal |
| `PATCH /api/preferences` | Preferencias del usuario autenticado |
| `GET /api/analytics?start=...&end=...` | Fechas locales; fin exclusivo |
| `GET /api/export?format=json\|csv` | Portabilidad del workspace; no copia de autenticación recuperable |

Los mutadores de dominio responden con `Snapshot` (201 en creación), salvo login
y logout. Errores JSON `{code,message}` y, para rechazos de origen, `reason`;
400 validación, 401 sesión, 403 autorización/CSRF/origen, 404 inexistente,
409 conflicto, 429 presupuesto de login, 503 verificación ocupada y 500 genérico.
No confiar en mensajes traducidos como contrato: conservar códigos y tipos.

## Frontend, idioma y runtime

`/` abre Tareas en tabla; `/tasks` respeta la preferencia guardada. Las demás
rutas son `/dashboard`, `/journal`, `/journal/YYYY-MM-DD`, `/progress`,
`/projects`, `/projects/:id`, `/archive` y `/settings`. La navegación móvil
conserva cuatro destinos y «Más»; el rail intermedio y las listas/grupos móviles
se adaptan al viewport sin detección por user-agent.

El usuario guarda `es`/`en` en SQLite; la migración usa español por defecto.
`t()` toma textos fuente españoles y consulta el catálogo inglés, con fallback
al original. `translateError` localiza errores en presentación. El idioma local
solo es una pista para el login; ni tareas ni credenciales viven en localStorage.
Los IDs, enums y contenido personal no se traducen.

`npm run dev` activa Vite middleware en el mismo proceso que Express y HMR en
el mismo puerto. Vite no sirve libremente el repositorio: `publicDir:false`,
frontera léxica/realpath y lista explícita de dos recursos oficiales de marca.
`npm run build` produce `dist`; `npm start` lo sirve sin Vite por defecto.
`FOCUS_DEV=true` permite activarlo desde el arranque administrado. Cambios del
backend requieren reiniciar; las instrucciones completas están en [Operaciones](OPERATIONS.md).

## Límites que deben preservarse al evolucionar

`App` todavía reúne el shell y coordinación de estado/peticiones; mantener allí
la propiedad canónica evita efectos duplicados y cambios de contexto inesperados.
`ProjectsPage` agrupa vistas relacionadas y el CSS responsive base conserva una
secuencia extensa. Son ámbitos de mantenimiento, no módulos de infraestructura nuevos.
En backend, `Domain` mantiene validación, consultas y transacciones bajo el mismo
contexto autorizado; `app.ts` conserva el orden explícito de middleware y rutas.
Extraerlos exige preservar esas fronteras, no solo repartir métodos. Los tipos
internos `Row`/formularios siguen siendo flexibles y no sustituyen la validación
servidor; mejorar ese tipado es trabajo separado de la organización del frontend.


SQLite síncrono y `Snapshot` completo son adecuados para la versión personal,
pero no garantizan escalado multiinstancia ni grandes historiales. No hay
paginación del backend para tareas/eventos ni virtualización general; el diario
pagina en cliente. Hay aislamiento de workspace comprobado, pero no gestión
multiusuario, invitaciones, roles colaborativos ni recuperación remota de cuenta.
La previsualización JSON es de solo lectura y comprueba colecciones, no integridad
completa. No hay importación JSON/Notion; restaurar requiere la copia SQLite y su procedimiento.
Codespaces y la excepción de su proxy son un entorno privado de desarrollo,
no una arquitectura de producción aprobada. Disponibilidad, almacenamiento externo,
backups automatizados y despliegue duradero siguen pendientes.
