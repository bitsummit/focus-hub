Focus Hub v1.1 refina los flujos diarios sin cambiar React/Express/SQLite ni el modelo de datos. La tabla móvil pasa a lista editable; captura rápida con panel inferior, chips, Kanban plegable, estados semánticos en claro/oscuro y Dashboard «Tu espacio» con métricas legibles.

- Español/English desde Ajustes, preferencia por usuario persistente, catálogo de interfaz centralizado y migración aditiva compatible con copias anteriores; el contenido del usuario no se traduce.
- Edición directa de proyecto, estado y prioridad; captura idempotente con reintentos sin duplicar incluso tras perder una respuesta confirmada.
- Recuperación SQLite online: copia consistente, verificación y restauración en destino nuevo con sesiones revocadas. Ninguna base existente se sustituye.
- Documentación UX/readiness/Codespaces y 14 capturas ficticias de escritorio/móvil.
- Se mantienen privacidad, puerto privado, historial y funcionalidades originales. Sin despliegue público ni importación Notion.

Validación: compilación TypeScript/Vite; 56 tests de backend/lógica; suite Chromium completa (15 casos, incluidos HMR/proxy, datos persistentes, reinicio real y backup/restore); siete anchos y dos temas, Kanban con 20/50 tareas por estado y 100 totales. Resultados y límites exactos en docs/UX_REVIEW_V1_1.md.

Pendiente de comprobación personal: VoiceOver/NVDA, teclado físico/virtual de iOS y descargar/restaurar una copia externa del Codespace antes de introducir datos reales. Codespaces sigue siendo desarrollo, no alojamiento de producción estable.

Esta rama parte del desarrollo privado existente e incluye también sus commits aún no integrados en main: configuración de agentes/Codespaces, hardening de autenticación y HMR. Revisar el conjunto antes de integrar. No fusionar sin aprobación del propietario.
