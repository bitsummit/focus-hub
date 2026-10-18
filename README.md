# Focus.

**Quiet the noise. Find clarity.**

Aplicación privada de gestión personal de tareas, proyectos y diario. Una tarea
mantiene la misma identidad en tabla, Kanban, diario, foco e histórico. Interfaz
en español e inglés, con temas claro y oscuro.

Stack actual: React 19, TypeScript y Vite 7; Node.js 24, Express 5 y PostgreSQL
persistente mediante un pool pequeño y configurable. Autenticación local con
sesiones; sin registro público.

## Probar la demo

Con Node.js 24, npm y Docker operativo, desde un checkout nuevo sin datos previos:

```sh
bash .devcontainer/setup.sh
bash .devcontainer/start.sh
```

El acceso se genera localmente en `.data/demo-access.json`; ábrelo en tu editor,
no lo compartas ni lo añadas a Git. La demo usa datos ficticios y una base
separada (`focus_demo`); desarrollo independiente usa `focus_dev` y los tests
`focus_test` con esquemas temporales. Nuevos entornos tienen roles y contraseñas
diferentes; demos anteriores conservan su identidad hasta una adopción explícita.
PostgreSQL local escucha solo en loopback, con contraseña aleatoria guardada en
`.data/postgres-local.json`. No hay credenciales compartidas ni servicios de pago.
Si hay datos SQLite anteriores, la preparación se detiene sin sustituirlos: sigue
la [migración explícita](docs/OPERATIONS.md#migrar-una-copia-sqlite-sin-reemplazar-datos).
Vite y API comparten el puerto 3000 con recarga del frontend. `npm start` sirve el compilado y necesita antes
`npm run build`. No ejecutes dos servidores en el mismo puerto.

En GitHub Codespaces, la configuración instala y arranca la demo automáticamente.
Abre **Ports → 3000 → Open in Browser**, con visibilidad **Private**. Sigue
[Operaciones](docs/OPERATIONS.md) para crear/reabrir el Codespace, obtener el
acceso, actualizar, reiniciar y recuperar datos.

## Documentación vigente

- [Producto](docs/PRODUCT.md): capacidades, reglas e invariantes de aceptación.
- [Arquitectura](docs/ARCHITECTURE.md): módulos, contratos y persistencia.
- [Identidad visual](docs/BRAND_IDENTITY.md): marca y recursos oficiales.
- [Operaciones](docs/OPERATIONS.md): entorno, Git, credenciales y recuperación.
- [Seguridad](docs/SECURITY.md): controles, supuestos y riesgos abiertos.
- [AGENTS.md](AGENTS.md): políticas de ingeniería y mantenimiento documental.

Referencias visuales con datos ficticios: aplicación
[escritorio](docs/screenshots/brand/app-desktop-light.png) /
[móvil](docs/screenshots/brand/app-mobile-light.png); login
[escritorio](docs/screenshots/brand/login-desktop-light.png) /
[móvil](docs/screenshots/brand/login-mobile-light.png).

## Desarrollo y límites

Repositorio privado: [bitsummit/focus-hub](https://github.com/bitsummit/focus-hub).
Se trabaja directamente en `dev/focus-hub-v1.1-ux-readiness`; `main` es la versión
estable y solo recibe integraciones aprobadas. No se crean ramas por tarea.

Los entornos de desarrollo son Node.js 24 con PostgreSQL local Docker y Codespaces
privado. La aplicación exige `DATABASE_URL` y migraciones aplicadas: no crea una
base vacía de reemplazo si falla la conexión. Con una URL explícita, el arranque
no migra ni siembra automáticamente. La configuración completa de Codespaces
necesita validación en la cuenta real.

Los volúmenes Docker locales no sustituyen backups externos; reconstruir o eliminar
un Codespace puede perderlos. Git conserva código, no datos. Neon PostgreSQL es el
destino gestionado previsto, sin aprovisionamiento ni despliegue de producción.
Tampoco hay Better Auth, sincronización offline, autenticación Google ni integración
Notion. Las pruebas locales no certifican disponibilidad ni seguridad
para datos reales: revisar [Seguridad](docs/SECURITY.md) y
[Operaciones](docs/OPERATIONS.md) antes del uso cotidiano.
