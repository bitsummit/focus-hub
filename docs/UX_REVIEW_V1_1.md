# Focus Hub v1.1 · revisión de UX

## Plan y contratos de trabajo

Se conserva React/Express/SQLite, el esquema y las siete secciones. No se importan
registros reales ni se publica el servicio. Rama: `dev/focus-hub-v1.1-ux-readiness`.

1. Auditoría: componentes operativos, sistema visual y recuperación revisados por
   tres agentes de lectura. Hallazgos: filtros compartidos con Archivo, overrides
   claros que rompen oscuro, captura sin prioridad explícita y ausencia de restore.
2. Sistema compartido: tokens semánticos por estado y tema, controles y foco;
   feedback accesible. Contrato `.status-<estado>` y métricas `data-tone`.
3. Flujos: lista móvil <=767 px, tabla editable en escritorio, Kanban agrupado
   móvil/columnas desktop, captura modal y chips combinados con filtros avanzados.
4. Dashboard y avances: «Tu espacio», cabeceras compactas, copy funcional y
   colores de métricas sin alterar fórmulas; revisión de las siete secciones.
5. Validación: regresiones originales, nuevos escenarios, anchos 360–1920,
   teclado/semántica accesible, persistencia y recuperación SQLite comprobable.

### Propiedad y dependencias

- Coordinador: `src/main.tsx`, filtros puros, API/contrato de captura, integración,
  versiones, validación final y Git.
- `ux11_operational_review`: `TaskViews.tsx` y su CSS; misma fuente canónica.
- `ux11_visual_review`: `ux-v11.css`, tokens y responsive global.
- `ux11_capture`: `QuickCapture.tsx` y su CSS; callback de captura idempotente.
- `ux11_readiness_review`: copias/verify/restore y pruebas, documento de readiness.
- `ux11_qa`: nuevos escenarios E2E, predicados y capturas ficticias.

No hay ediciones simultáneas en `main.tsx`, esquema, auth ni manifests. La API de
captura añade solo `priority` opcional, validada y persistida en el mismo INSERT;
los prefijos existentes siguen funcionando. No cambia el modelo relacional.

La política de chips/tareas abiertas solo se aplica a Tareas: Archivo conserva el
histórico. «Hoy» significa selección del foco diario, no vencimiento.

Las cinco fases quedan implementadas y verificadas localmente; los resultados y
las limitaciones externas se documentan a continuación.

## Decisiones e implementación

| Requisito | Entrega |
|---|---|
| UX-01 | En <=767 px la tabla se sustituye por una lista compacta: checkbox, título, prioridad, proyecto, estado y vencimiento opcional. Proyecto/estado/prioridad se editan directamente. Escritorio conserva tabla, ordenación y edición; prioridad usa bandera y selector accesible. |
| UX-02 | Tokens centralizados de texto/fondo/borde/indicador para los siete estados. Pendiente gris, curso azul, revisión violeta, espera ámbar, bloqueo coral, completada verde, cancelada gris. Etiquetas y puntos acompañan el color. Se corrigen overrides antiguos que anulaban el modo oscuro. |
| UX-03 | Captura superior con borde definido, Enter y Ctrl/⌘+K; foco y campo listos tras guardar. FAB abre dialog inferior sin desplazar la página, con título obligatorio y proyecto/prioridad opcionales. Guardar y seguir/cerrar, control de teclado virtual vía VisualViewport, bloqueo del fondo y recuperación del foco. |
| UX-04 | Chips Todas/Bandeja/Hoy/Prioritarias/En espera/Bloqueadas combinados por intersección con búsqueda y filtros avanzados desplegables. Limpiar filtros y mensajes distintos para vacío y sin coincidencias. Archivo tiene filtros independientes. |
| UX-05 | «Tu espacio» en cabecera y navegación, misma ruta /dashboard. Cabeceras sobrias con separadores y menor altura; se conserva foco semanal/diario, objetivos, proyectos y progreso en ese orden. Se retira microcopy motivacional. |
| UX-06 | Kanban desktop con drag & drop, contadores, scroll horizontal deliberado del tablero y vertical de página. Móvil usa grupos plegables por estado con controles directos; sin columnas horizontales ni scroll vertical anidado obligatorio. |
| UX-07 | Completadas verde, nuevas azul, reducción neta verde/neutral/ámbar según signo y backlog neutral. Tarjetas, barras y leyendas mantienen la misma semántica y valores textuales. Las fórmulas originales no cambian; se explica que capturar trabajo puede aumentar backlog. |
| UX-08 | Viewport y capacidades de interacción, sin detección por user-agent. Rail lateral de iconos en anchuras intermedias, navegación inferior móvil y captura flotante. Títulos, fechas y controles adaptables a orientación horizontal. |
| UX-09 | Contraste secundario mejorado, tipografía/espaciados/controles consistentes en las siete secciones, contenido largo ajustable, foco visible, movimiento reducido y objetivos táctiles. Feedback discreto accesible; indicador Guardando solo si tarda más de 250 ms. |

### Captura, sincronización y errores

Cada captura conserva un request_id en reintentos, incluso si el servidor confirmó
la escritura y se perdió la respuesta. Doble envío se bloquea inmediatamente;
un error conserva el título y permite reintentar. La prioridad explícita se escribe
en la misma operación, sin una segunda actualización. Capturar sin proyecto sigue
siendo una operación de una línea y entra en Bandeja de entrada.

Tabla, grupos móviles, diario, foco, proyectos y archivo usan los mismos IDs y la
respuesta canónica del servidor. Los filtros y la vista se conservan al navegar
internamente; una recarga completa reinicia filtros temporales. `/` sigue abriendo
la tabla; `/tasks` conserva la preferencia de vista guardada. No se copian tareas
entre vistas ni se utiliza localStorage como persistencia de datos.

Los cambios rápidos de estado ofrecen Deshacer, comprobando primero que no haya
un estado remoto posterior. Deshacer crea un nuevo evento: no borra el historial.
No se promete una transacción de edición colaborativa: cambios simultáneos del
mismo campo siguen la política original de última escritura. El diario conserva
sus revisiones y rechazo 409 de edición obsoleta. Los errores de red son recuperables;
no se añade almacenamiento offline ni una cola invisible.

## Validación reproducible

Se utilizan Node 24, SQLite real y Chromium instalado en `/usr/bin/chromium`.
Todas las cuentas, textos, bases y capturas son ficticios y aislados en directorios
temporales. No se sustituye ni se abre la base existente para estas pruebas.

```sh
npm ci
npm test
npm run build
npm run test:e2e
npm run screenshots:v11
```

No ejecutar compilaciones simultáneas con E2E: el navegador de entrega sirve dist.
Las pruebas de desarrollo verifican Vite/HMR por separado. `CHROMIUM_PATH` permite
indicar otro Chromium instalado; consultar CODESPACES.md antes de ejecutar allí.

### Los 15 escenarios v1.1

| # | Escenario | Evidencia |
|---|---|---|
| 1 | Cinco capturas consecutivas sin proyecto | E2E UX: Enter, campo vacío y foco retenido tras cada una. |
| 2 | Encontrarlas en Bandeja | E2E UX: cinco títulos presentes, proyecto null. |
| 3 | Asignar proyectos desde Tareas | E2E UX: cinco selects directos; desaparecen del chip Bandeja. |
| 4 | Chips y filtros combinados | E2E y tests puros: Hoy usa foco diario, prioridad/espera, búsqueda y limpieza. |
| 5 | Estado y prioridad rápidos | E2E desktop/móvil: selects directos con persistencia API. |
| 6 | Móvil y escritorio | E2E: lista móvil, tabla desktop, siete anchos y dos temas. |
| 7 | Completar, estadísticas y archivo | E2E: completed_at, un evento, archivo visible y logro en analytics. |
| 8 | Estados y colores coherentes | E2E: siete tokens con contraste >=4.5 en ambos temas, mismo foreground del selector en tabla/Kanban/móvil; editor conserva estado. Inspección visual de badges Dashboard y capturas. |
| 9 | Captura FAB | E2E: foco, error 503, reintento, guardar y seguir/cerrar; pérdida de respuesta después del commit no duplica tarea/evento. |
| 10 | Kanban 20/50 por estado | E2E: 100 registros, conteos 20 y 50, última tarjeta visible, plegado móvil, cambio de estado y drag/drop desktop con DataTransfer persistido. |
| 11 | Dashboard y métricas responsive | E2E: 360/390/430/768/1024/1440/1920, siete secciones, claro/oscuro; orientación 844x390. |
| 12 | Texto largo, vacíos y errores | E2E: título largo sin overflow, búsqueda sin coincidencias y limpieza; error de captura conserva el texto. Mensajes de vacíos revisados en componentes. |
| 13 | Regresiones de la especificación original | Se mantienen tests API/calendario/seguridad y recorridos originales; correspondencia debajo. |
| 14 | Persistencia efectiva | E2E daily-readiness: captura, recarga, logout/login, SIGTERM y nuevo proceso sobre el mismo archivo, backup online y recuperación en archivo nuevo. |
| 15 | Teclado y accesibilidad | E2E: Enter, Ctrl+K, Tab confinado en editor, Escape, árbol ARIA y controles con nombres; contexto touch verifica checkbox/proyecto/estado/prioridad/FAB >=44x44. VoiceOver/NVDA real pendiente. |

### Regresión de los 15 criterios originales

La matriz inicial `ACCEPTANCE.md` es histórica y conserva sus cifras de v1;
esta tabla y los resultados v1.1 siguientes son la referencia actual.

| Criterios originales | Cobertura conservada y ejecutada |
|---|---|
| 1–3 | Captura/recarga; tarea crítica del diario con proyecto SRA e identidad única; edición en tabla/Kanban y reflejo en diario. `app.spec.ts`, `api.test.ts`, pruebas de captura. |
| 4–6 | Espera externa/seguimiento, completar/reabrir con eventos, fechas, estadísticas y Archivo. Pruebas API y navegador. |
| 7–8 | Diario pasado, notas/encabezados/anidación y referencias, conflictos; foco diario/semanal y orden. API, journal-regression y app. |
| 9–10 | Hitos estratégicos independientes; calendarios IANA, límites UTC y DST de 23/25 horas. API/calendario. |
| 11–12 | Archivo y eventos históricos; descarga real y lectura de JSON/CSV con IDs e histórico. API y app. |
| 13 | Aislamiento entre usuarios, relaciones ajenas rechazadas, sesiones, CSRF, limitadores y proxy HTTPS. API/security/proxy. |
| 14–15 | Navegador móvil/escritorio, teclado, no overflow global, compilación y comandos reales. app/dev/proxy/UX/readiness. |

## Capturas ficticias de la versión compilada

En `docs/screenshots/v1.1/` se incluyen 14 PNG reproducibles; no contienen datos
reales, credenciales ni identificadores de la cuenta del propietario.

| Vista | Escritorio | Móvil |
|---|---|---|
| Tu espacio | [1440 px](screenshots/v1.1/dashboard-desktop.png) | [390 px](screenshots/v1.1/dashboard-mobile.png) |
| Tareas lista/tabla | [1440 px](screenshots/v1.1/tasks-list-desktop.png) | [390 px](screenshots/v1.1/tasks-list-mobile.png) |
| Tareas Kanban | [1440 px](screenshots/v1.1/tasks-kanban-desktop.png) | [390 px](screenshots/v1.1/tasks-kanban-mobile.png) |
| Mis avances | [1440 px](screenshots/v1.1/progress-desktop.png) | [390 px](screenshots/v1.1/progress-mobile.png) |
| Editor | [1440 px](screenshots/v1.1/task-editor-desktop.png) | [390 px](screenshots/v1.1/task-editor-mobile.png) |
| Captura rápida | Campo superior en tabla/dashboard | [Panel inferior](screenshots/v1.1/quick-capture-mobile.png) |

Además: lista a 360 px, tablet a 768 px y editor móvil oscuro. Reproducir con
`npm run screenshots:v11`; usa base temporal y puerto local efímero propios.

## Límites y siguiente comprobación personal

- No se ha ejecutado VoiceOver/NVDA ni el teclado virtual físico del iPhone. La
  semántica ARIA, foco, controles nativos y adaptación VisualViewport están probados
  o implementados; falta el recorrido asistivo y táctil real del propietario.
- El barrido de siete resoluciones mide overflow y disponibilidad de secciones;
  no es una certificación visual exhaustiva de cada combinación posible.
- 100 tareas sirven como prueba de la escala solicitada, no como benchmark de
  miles de registros: no se añade paginación o virtualización en esta iteración.
- Codespaces real, copia externa y disponibilidad estable no quedan certificados
  por los tests locales. Ver `DAILY_USE_READINESS.md` antes de almacenar datos reales.
- Conservadas arquitectura, privacidad, esquema, autenticación, fechas e histórico.
  No hay despliegue público, importación Notion, merge a main ni cambio de puerto.

## Equipo utilizado realmente

Se usaron cinco subagentes nativos con tareas acotadas: operational_review
(tabla/Kanban), visual_review (tokens/CSS), capture (panel de captura),
readiness_review (recuperación/evidencia) y QA (tests/capturas). Los tres primeros
análisis independientes fueron operativo, visual y readiness; se consolidaron antes
de editar. Los perfiles pertinentes de `.codex/agents/` se leyeron y aplicaron como
instrucciones; este runtime no ofrece seleccionar esos roles personalizados al
crear el agente. No se afirma carga automática de roles. El coordinador integró
contratos/API/App, revisó entregas y ejecutó las verificaciones finales.

## Resultado final de las verificaciones · 16 de octubre de 2026

| Comprobación ejecutada | Resultado |
|---|---|
| `npm test` | **48/48**, cero fallos, cero omitidas; 21,1 s. Incluye API, aislamiento, autenticación, calendario, idempotencia, filtros y seis casos de recuperación. |
| `npm run build` | TypeScript y Vite 7.3.7 correctos; bundle generado sin errores. |
| `npm run test:e2e` | **14/14**, Chromium, 1,1 min; workers=1 y servidor de prueba aislado. |
| `npm audit --json` | **0 vulnerabilidades conocidas**, dependencias runtime y desarrollo; consulta realizada en esta entrega. |
| `git diff --check` | Sin errores de whitespace. |
| `npm run screenshots:v11` | 14 capturas ficticias en la carpeta de esta entrega. |

El cierre E2E comprobó además drag/drop real con DataTransfer, controles táctiles
>=44 px, pérdida de respuesta después de escritura y recuperación tras reiniciar
el proceso. En las pasadas de integración se corrigieron dos expectativas de test
(nombre/contador del menú y espera de carga antes del atajo) y un defecto real:
el borde del contenedor reducía a 42 px el selector táctil de prioridad. La pasada
final completa se ejecutó después de corregirlo; no se omitieron tests.

Para probar en el Codespace existente, seguir la sección «Actualizar tu Codespace
existente a v1.1» de [CODESPACES.md](CODESPACES.md). No cambia contraseña, datos ni
visibilidad del puerto. Esta rama incluye commits previos de desarrollo todavía
no integrados en main; el PR debe revisar también ese contexto. No se ha fusionado.

Evidencia conservada: [salida de las pruebas](validation/v1.1/test-results.txt) y
[auditoría npm](validation/v1.1/npm-audit.json), correspondiente al commit
`7149167` y al pulido `79b65de` (suite completa repetida tras el pulido).
Las capturas se regeneraron después de esa compilación.

La inspección final de capturas extendió los tokens de contraste a notas de
estadísticas, navegación temporal, acciones secundarias, metas y vacíos; retiró
el microcopy decorativo residual del diario, objetivos y foco vacío.
