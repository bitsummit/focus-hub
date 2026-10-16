# Entrega de revisión privada

## Conservación en GitHub

- Repositorio: https://github.com/bitsummit/focus-hub
- Rama: `dev/focus-hub-v1-codespaces`.
- La implementación original `ed9f9ab` se conserva como antecesora de todos los cambios de entrega.
- No se envía a `main`, no hay reset ni force push. Durante la entrega se detectó que el remoto ya había integrado la v1 mediante el PR #1 (merge `d4af79f`) y eliminado README_INICIO.md (`a310ec1`). Se incorporaron ambos cambios mediante un merge normal a la rama de desarrollo; se respeta esa eliminación.
- `AGENTS.md`, `CODEX_START_HERE.md` y `FOCUS_HUB_CODEX_MASTER_PROMPT.md` se conservan sin cambios respecto de main. `.codex/agents/` sigue sin estar disponible.
- `.codex/agents/` no existe en este checkout. No se han sustituido configuraciones de agentes ni inventado perfiles. Para esta entrega se usaron agentes nativos reales para revisión de seguridad y QA de Codespaces; el coordinador integró scripts/configuración, pruebas limpias y Git.
- Se excluyen `.data/`, `.env`, `.env.*` salvo `.env.example`, SQLite, claves, dependencias, compilación y resultados de pruebas. La contraseña de la demo se genera por Codespace y se guarda localmente con permisos 0600; no se envía a GitHub.

El [PR inicial #1](https://github.com/bitsummit/focus-hub/pull/1) figura integrado en el historial de main. El nuevo PR de Codespaces es independiente y su cuerpo está preparado en [PULL_REQUEST.md](PULL_REQUEST.md). La API `api.github.com` está bloqueada en esta instancia por el proxy de salida (CONNECT 403), mientras que Git HTTPS sí permite fetch/push. Por ello la creación automática del PR puede necesitar que se aplique la ampliación de red guardada en el borrador del entorno. No es un error de contraseña ni evidencia de falta de permisos del repositorio.

Si el bloqueo persiste, el enlace devuelto por GitHub al subir la rama permite abrir el formulario del PR:

https://github.com/bitsummit/focus-hub/pull/new/dev/focus-hub-v1-codespaces

Selecciona base `main`, head `dev/focus-hub-v1-codespaces`, copia el título y cuerpo de PULL_REQUEST.md y crea el PR de revisión. Este enlace abre un formulario; no debe confundirse con un PR ya creado.

## Validación realizada desde una copia limpia

Se clonó la rama desde GitHub en una carpeta temporal, sin copiar `.data`, `node_modules` ni `dist` del entorno de desarrollo. Se ejecutaron:

| Comprobación | Resultado |
|---|---|
| Esquema oficial devcontainer, JSON y sintaxis shell/Node | Correctos |
| Etiqueta `mcr.microsoft.com/devcontainers/javascript-node:5.2.3-24-bookworm` | Presente en el registro oficial |
| `bash .devcontainer/setup.sh` | Instala desde lockfile, compila y crea demo ficticia |
| Repetir setup | Conserva exactamente la base y el archivo de acceso; permisos 0700/0600 |
| `npm test` | **11/11 aprobadas**, sin omisiones |
| `npm run test:e2e` | **4/4 aprobadas** en Chromium, 9,9 s |
| `bash .devcontainer/start.sh` en puerto 3000 | Arranque funcional y autenticación verificados |
| Repetir start | Reutiliza únicamente el servicio gestionado compatible, sin duplicarlo |
| Stop + start | Conserva y recupera los registros persistentes |
| Origen HTTPS reenviado simulado | Login, cookies Secure/HttpOnly/SameSite, datos y CSRF correctos |
| Puerto ocupado/configuración distinta | Rechazados; no se mata el proceso ajeno ni se le envían credenciales |
| Diff de la copia limpia tras ejecutar los scripts | Sin modificaciones versionadas |

Las pruebas verifican el contenido de la aplicación ya existente: captura, persistencia, diario/referencias/subtareas, estados/seguimiento, foco, hitos, histórico, calendario/DST, exportaciones, aislamiento entre usuarios, edición en dos pestañas y móvil. La matriz detallada permanece en ACCEPTANCE.md.

## Pendiente en la primera apertura real

No se ha creado un Codespace desde esta instancia ni se ha consumido capacidad de Codespaces en nombre del usuario. Docker está disponible, pero el proxy impidió descargar la imagen desde el CDN regional `centralus.data.mcr.microsoft.com`. El tag se verificó; no se afirma haber ejecutado la imagen completa.

Queda comprobar dentro de GitHub: aprovisionamiento de la imagen, disponibilidad de cuota/permiso Codespaces, forwarding del puerto 3000 con visibilidad **Private**, acceso autenticado HTTPS desde el navegador y persistencia al detener/reanudar ese Codespace. La configuración y los comandos de aplicación están probados; el servicio de alojamiento externo no se ha simulado como si estuviera validado.

No hay despliegue público/producción, cambios de arquitectura, integración de Notion, datos reales ni integración automática del PR. La [guía de acceso](CODESPACES.md) explica cada paso, incluida la consulta privada de credenciales mediante el editor web.

## Corrección posterior: origen reescrito en Codespaces

La primera prueba real encontró que el proxy entrega Origin y Host como `http://localhost:3000`, aunque la pestaña usa el origen HTTPS correcto. Un curl interno con el origen público daba 200; el diagnóstico reducido confirmó la reescritura.

La corrección admite únicamente el endpoint interno exacto con Codespaces activo y Fetch-Site same-origin; conserva restricciones de modo/destino cuando se reciben. El login exige un desafío previo aleatorio, de diez minutos y un solo uso, ligado a cookie __Host Secure/HttpOnly/SameSite Strict. Todas las escrituras posteriores mantienen el token CSRF de sesión. No se confía en X-Forwarded-Host ni se habilita CORS.

Verificación actual: **17 pruebas backend/seguridad y 5 pruebas Chromium aprobadas**, más build. La prueba nueva usa un proxy HTTPS real local con la misma reescritura: login, captura y persistencia funcionan; una web atacante recibe 403. Se probaron retos ausentes, falsificados, repetidos, expirados y cookies duplicadas. El reinicio gestionado con la demo existente también pasó. La comprobación final desde el Codespace personal requiere actualizar, recompilar, reiniciar y recargar según CODESPACES.md; sus datos y contraseña se conservan.

## Desarrollo con Vite en el puerto privado

Codespaces arranca ahora con Vite integrado en el mismo servidor HTTP que la API: puerto 3000, SQLite y autenticación existentes. `npm run dev` funciona también sin sintaxis de variables de shell; `npm start` conserva el modo compilado. El WebSocket usa el origen HTTPS exacto configurado, sin habilitar CORS ni otro puerto. El servidor de desarrollo bloquea `.data`, credenciales, claves y código del backend en su acceso a archivos.

El coordinador implementó e integró el servidor y los scripts; el subagente real `dev_qa` escribió `tests/dev.spec.ts`. La verificación final pasó **17 pruebas backend, 7 pruebas Chromium y build**. Las dos nuevas pruebas arrancan procesos con bases ficticias aisladas y verifican login, captura persistente, conexión WebSocket, aplicación de CSS sin navegación y bloqueo de archivos privados. Cubren el arranque local sin origen configurado y un proxy HTTPS que reescribe Origin/Host y transporta WebSocket. El arranque gestionado y su repetición también pasaron con la demo existente.

La activación en un Codespace existente requiere una sola actualización y reinicio, sin build, según CODESPACES.md. A partir de ahí los cambios del frontend que lleguen mediante `git pull` se reflejan automáticamente. Los cambios del backend requieren reiniciar el proceso. La conexión HMR desde el Codespace personal queda pendiente de que el usuario aplique la actualización; la simulación HTTPS no se presenta como una prueba en su cuenta.
