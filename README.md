# Focus.

**Quiet the noise. Find clarity.**

Aplicación privada de gestión personal de tareas, proyectos y diario. Una tarea
mantiene la misma identidad en tabla, Kanban, diario, foco e histórico. Interfaz
en español e inglés, con temas claro y oscuro.

Stack actual: React 19, TypeScript y Vite 7; Node.js 24, Express 5 y SQLite
persistente. Autenticación local con sesiones; sin registro público.

## Probar la demo

Con Node.js 24 y npm, desde el checkout existente:

```sh
npm ci
npm run demo
FOCUS_DB=.data/demo.sqlite npm run dev
```

El acceso se genera localmente en `.data/demo-access.json`; ábrelo en tu editor,
no lo compartas ni lo añadas a Git. La demo usa datos ficticios y una base
separada. Si ya existe, omite `npm run demo`: la conserva y termina con error.
Vite y API comparten el puerto
3000 con recarga del frontend. `npm start` sirve el compilado y necesita antes
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

Los entornos soportados son Node.js 24 local y Codespaces privado. SQLite vive
en el disco del entorno, no en GitHub ni en D1. Detener un Codespace interrumpe
el acceso; eliminarlo puede destruir los datos sin copia externa. No existe aún
un despliegue de producción, sincronización offline, autenticación Google ni
integración Notion. Las pruebas locales no certifican disponibilidad ni seguridad
para datos reales: revisar [Seguridad](docs/SECURITY.md) y
[Operaciones](docs/OPERATIONS.md) antes del uso cotidiano.
