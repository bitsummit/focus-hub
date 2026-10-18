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
| [`src/main.tsx`](../src/main.tsx) | Sesión, navegación SPA, estado canónico, formularios, siete secciones y métricas |
| [`src/components/`](../src/components/) | Tabla/Kanban, captura móvil, confirmación de proyecto y `BrandLogo` |
| [`src/task-filters.ts`](../src/task-filters.ts) | Predicados de chips y filtros combinados |
| [`src/i18n.ts`](../src/i18n.ts), [`src/locales/en.json`](../src/locales/en.json) | Traducción de interfaz y formato localizado |
| [`src/styles.css`](../src/styles.css), [`src/ux-v11.css`](../src/ux-v11.css) y CSS de componentes | Temas, tokens semánticos, controles y adaptación responsive |
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
React. `src/main.tsx` y la cascada CSS siguen siendo grandes; esta descripción no
implica una separación en módulos que aún no existe.

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
