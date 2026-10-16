# Focus Hub v1 funcional con demo privada en Codespaces

El repositorio partía de la especificación, sin aplicación ejecutable. Esta entrega incorpora la v1 full-stack con tareas canónicas, diario, Kanban/tabla, proyectos, objetivos/hitos, foco, estadísticas, archivo y exportación, sobre SQLite persistente y sesiones reales. Añade Codespaces para poder probarla desde el navegador: instalación congelada, demo ficticia separada, credenciales aleatorias fuera de Git y arranque automático en el puerto 3000, privado por defecto en Codespaces.

La implementación inicial se conserva en `ed9f9ab`. El cambio de entrega mantiene la arquitectura y funcionalidades; adapta únicamente el control de origen para el proxy HTTPS, añade lifecycle/configuración de desarrollo y refuerza exclusiones de archivos locales. AGENTS.md y la especificación original se conservan; `.codex/agents/` no estaba disponible y no se inventan perfiles.

Validación: véanse `docs/ACCEPTANCE.md` y `docs/CODESPACES.md`. La primera versión pasó 9 pruebas API/calendario, 4 recorridos Chromium y build. La entrega añade pruebas de cookies Secure, origen HTTPS exacto y CSRF, además de una instalación y arranque desde clon limpio. El informe de entrega recoge los resultados finales.

Límites: no se ha aprovisionado un Codespace real. La descarga de la imagen oficial desde Codex fue bloqueada por el proxy de salida; la comprobación de imagen/forwarding privado/login en GitHub queda para la primera apertura. No hay publicación pública, producción, Notion, datos reales ni contraseñas versionadas. No se integra automáticamente en main ni se usa force push.
