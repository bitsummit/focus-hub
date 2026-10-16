# Probar Focus Hub en GitHub Codespaces

Esta entrega conserva la v1: React/TypeScript, servidor Node, SQLite persistente y autenticación real. El entorno es de desarrollo con datos ficticios; no es un despliegue público ni de producción. No requiere instalar herramientas en tu ordenador.

## 1. Abrir el entorno desde el navegador

1. Inicia sesión en GitHub con la cuenta que tiene acceso al [repositorio privado](https://github.com/bitsummit/focus-hub).
2. Abre la [rama de entrega](https://github.com/bitsummit/focus-hub/tree/dev/focus-hub-v1.1-ux-readiness). Confirma que el selector de rama muestra **dev/focus-hub-v1.1-ux-readiness**; `main` ya contiene la v1 inicial, pero esta rama incorpora su configuración de Codespaces hasta revisar e integrar el nuevo PR.
3. Pulsa **Code → Codespaces → Create codespace on dev/focus-hub-v1.1-ux-readiness**. Si GitHub muestra **New with options**, selecciona esa rama y `.devcontainer/devcontainer.json`. Bastan 2 CPU y 4 GB de RAM.
4. Espera a que termine la creación. Automáticamente se ejecutan `npm ci`, una compilación de comprobación, la creación inicial de la demo y el arranque en modo desarrollo con Vite. El proceso termina comprobando login, datos persistentes y referencias del diario. No se imprimen contraseñas.
5. Abre la pestaña **Ports / Puertos** del panel inferior. Debe aparecer **3000 · Focus Hub · privado**. Comprueba que **Port Visibility / Visibilidad del puerto** es **Private**. Es el valor predeterminado de GitHub para un puerto nuevo. No elijas `Public` ni `Private to Organization`.
6. Pulsa el icono **Open in Browser / Abrir en el navegador** de la fila 3000. GitHub puede pedirte autenticarte para acceder al puerto privado. La dirección externa usa HTTPS aunque la conexión interna del contenedor sea HTTP.

La configuración no solicita accesibilidad pública. La visibilidad pertenece a GitHub Codespaces y no tiene una propiedad estándar en el esquema devcontainer para fijarla: se usa el valor predeterminado privado y se verifica en **Ports**. Si reutilizas un Codespace en el que hubieras cambiado antes la visibilidad, restáurala a **Private** antes de abrirlo. Si dispones de GitHub CLI autenticado, también puedes ejecutar `gh codespace ports visibility 3000:private --codespace "$CODESPACE_NAME"`.

Si no aparece 3000, ejecuta en la terminal de Codespaces:

```sh
bash .devcontainer/start.sh
```

El comando es idempotente y no duplica el servidor. Puedes consultar `.data/codespaces-server.log` si falla. No se detienen procesos ajenos que ocupen el puerto.

## Actualizar tu Codespace existente a v1.1

Conserva el mismo Codespace para conservar su base y credenciales. Antes de
actualizar, revisa `git status`: si hay cambios tuyos, guárdalos en un commit o
copia aparte y resuelve su integración; no uses reset, checkout forzado ni limpieza.

Desde la terminal, en la raíz del repositorio:

```sh
git status
git fetch origin dev/focus-hub-v1.1-ux-readiness:refs/remotes/origin/dev/focus-hub-v1.1-ux-readiness
git switch dev/focus-hub-v1.1-ux-readiness
git merge --ff-only origin/dev/focus-hub-v1.1-ux-readiness
node .devcontainer/service.mjs stop
npm ci
bash .devcontainer/start.sh
```

El fetch explícito funciona también si el clon original solo sigue `main`.
`git switch` crea el seguimiento de la rama remota si todavía no existe localmente;
si Git rechaza el cambio para proteger archivos, detente y conserva esos cambios.
El arranque comprueba la compilación y vuelve a servir Vite con HMR. No reconstruye
el contenedor, no reemplaza SQLite y no cambia tu contraseña. Recarga el navegador
al terminar y abre **Ports → 3000 → Open in Browser** manteniendo **Private**.

Prueba primero captura sin proyecto, chip Bandeja, cambio directo de proyecto,
estado y prioridad, lista/Kanban móvil y «Tu espacio». Consulta
[la revisión v1.1](UX_REVIEW_V1_1.md) y [recuperación y uso cotidiano](DAILY_USE_READINESS.md).

## 2. Obtener las credenciales de prueba

En la terminal **dentro de Codespaces**, ejecuta:

```sh
code .data/demo-access.json
```

Se abrirá un archivo privado en el editor. Copia `email` y `password` en el formulario de Focus Hub. No pegues la contraseña en el chat, en un issue o en el PR.

- El correo es ficticio. La contraseña se genera criptográficamente al crear la demo, nunca se fija en el código.
- El archivo tiene permisos `0600`; la carpeta `.data` tiene `0700`. Credenciales, base SQLite, logs y PID están ignorados por Git.
- Reanudar o reconstruir **el mismo Codespace** conserva sus datos y credenciales mientras GitHub conserve el workspace. No se vuelven a generar ni se sobrescriben.
- Crear **otro Codespace** genera otra base y otra contraseña. Reproducible significa que se repite el proceso seguro, no que se comparte una contraseña fija.
- Eliminar el Codespace elimina su copia local de los datos. Usa las exportaciones antes de eliminarlo si quieres conservar tus pruebas.

## 3. Qué probar

1. Captura una tarea con el título y Enter; recarga y comprueba que sigue allí.
2. Crea un proyecto `SRA`. En Diario añade `# SRA` y luego `- [ ] !! Preparar presentación #SRA`.
3. Cambia esa tarea en Kanban o tabla, vuelve al Diario y comprueba que tiene el mismo estado.
4. Selecciona foco diario/semanal, cambia el orden y recarga.
5. Completa y reabre una tarea; consulta el historial y Mis avances.
6. Crea un objetivo con hitos; logra uno y comprueba el progreso.
7. En Ajustes descarga JSON/CSV y cambia tema o zona horaria.

La [matriz de los 15 criterios](ACCEPTANCE.md) recoge la verificación funcional de la v1. Usa solo datos ficticios en este entorno de prueba.

## 4. Reanudar y seguir desarrollando con recarga automática

Para volver a entrar, visita GitHub → Codespaces y abre el Codespace existente. `postStartCommand` reinicia el servicio si hace falta. No crees otro por accidente si deseas conservar las pruebas.

Si tu Codespace ya existía antes de activar este modo, actualízalo una sola vez:

```sh
git pull --ff-only
node .devcontainer/service.mjs stop
bash .devcontainer/start.sh
```

Desde entonces, Vite sirve el frontend directamente desde `src`, sin depender de `dist`. Al guardar CSS, el navegador aplica los estilos sin recargar la página; los cambios de JavaScript/TypeScript se actualizan o provocan una recarga según el módulo. La API, el frontend y el WebSocket de Vite usan **el mismo puerto privado 3000**, también bajo HTTPS en Codespaces. No abras otro puerto.

Los cambios hechos desde Codex llegan a otro checkout: necesitas `git pull --ff-only` para traerlos a tu Codespace. Si solo cambian archivos del frontend, Vite los detecta al terminar el pull y no hace falta ejecutar `build` ni reiniciar. Si cambian dependencias, ejecuta `npm ci`; si cambia el backend o la configuración del servidor, detén y arranca el servicio con los dos comandos anteriores. No necesitas reconstruir el contenedor por un cambio de código.

Para arrancar manualmente fuera del servicio gestionado puedes usar `npm run dev` (compatible con PowerShell). Usa la base y las credenciales de la demo mediante las instrucciones anteriores en Codespaces. `npm start` sigue sirviendo la versión compilada para pruebas de entrega; para usar ese modo con el gestor ejecuta `npm run build` y después `FOCUS_DEV=false bash .devcontainer/start.sh`, con el servicio anterior detenido.

Para verificar la demo y las reglas del backend:

```sh
npm run smoke:demo
npm test
```

`npm run test:e2e` usa Chromium. La imagen del entorno permite probar la app sin instalarlo; la suite de navegador necesita Chromium adicional. En este entorno de Codex se ha probado con `/usr/bin/chromium`; en Codespaces puedes instalarlo con `sudo apt-get update && sudo apt-get install -y chromium` y después ejecutar la suite. No reconstruyas `dist` durante las pruebas de navegador.

No hay importación destructiva, conexiones a Notion ni un despliegue de producción. Antes de integrar el PR, continúa en la rama de desarrollo; después de integrarlo podrás crear Codespaces desde `main`.

## 5. Privacidad, costes y límites verificados

- El servicio escucha `127.0.0.1:3000`. Codespaces proporciona forwarding autenticado; no se publica un servidor externo.
- El arranque configura cookies `Secure` y el origen HTTPS exacto a partir de `CODESPACE_NAME` y `GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN`. Mantiene CSRF y no confía en `X-Forwarded-Host` arbitrario.
- GitHub puede requerir que tu cuenta/organización permita Codespaces y tenga cuota disponible. No se ha creado ningún Codespace ni contratado capacidad desde Codex. Detén el Codespace desde GitHub cuando acabes para evitar consumo innecesario.
- El esquema devcontainer y la etiqueta de la imagen se contrastaron con fuentes oficiales. La descarga de la imagen en Codex quedó bloqueada por el proxy en `centralus.data.mcr.microsoft.com`; no se ha ejecutado aquí un contenedor completo ni un Codespace real.
- Los mismos scripts pasaron desde un clon limpio de GitHub con Node 24: instalación/build, 11 pruebas API/calendario/seguridad y 4 recorridos Chromium; arranque/reinicio en 3000 y conservación de datos. Las pruebas HTTP simulan el proxy HTTPS y verifican cookies/origen/CSRF. La primera creación real debe confirmar imagen, forwarding privado y login desde tu navegador. No se afirma que estas comprobaciones externas estén hechas.

Fuentes: [puertos de Codespaces](https://docs.github.com/en/codespaces/developing-in-a-codespace/forwarding-ports-in-your-codespace), [esquema devcontainer](https://github.com/devcontainers/spec/blob/main/schemas/devContainer.base.schema.json), [imagen oficial Node](https://github.com/devcontainers/images/tree/main/src/javascript-node). Las fuentes GitHub se consultaron mediante sus archivos oficiales en `raw.githubusercontent.com` cuando el proxy bloqueaba los sitios de documentación.

## Si el login muestra «Origen no permitido»

El error se produce antes de comprobar la contraseña. Conserva la demo y las credenciales. Desde la rama de entrega actualizada, reinicia únicamente el servidor gestionado:

```sh
git pull --ff-only
node .devcontainer/service.mjs stop
npm run build
bash .devcontainer/start.sh
```

Recarga la pestaña para cargar el formulario actualizado. La demo y la contraseña se conservan.

Si persiste tras recargar la pestaña, intenta entrar una vez y consulta solo el diagnóstico de origen:

```sh
grep FOCUS_ORIGIN_REJECTED .data/codespaces-server.log | tail -3
```

Esas líneas contienen el origen/host y la procedencia de la solicitud; no registran contraseñas, cookies ni el cuerpo de las peticiones. Permiten distinguir un origen reescrito por el proxy de una configuración incorrecta. No desactives CSRF ni añadas comodines de dominios para evitar el error. `npm start` también configura ahora el origen y las cookies a partir de las variables oficiales de Codespaces.

### Corrección del proxy observada en Codespaces

Se confirmó un caso real: el navegador usa el origen HTTPS privado, pero el proxy entrega al servidor `Origin: http://localhost:3000` y `Host: localhost:3000`, con `Sec-Fetch-Site: same-origin`. La comprobación anterior rechazaba esa reescritura.

Se permite únicamente ese endpoint interno exacto para el puerto configurado, con Codespaces activo, origen público HTTPS configurado y metadatos de misma procedencia. No se confía en dominios comodín ni en X-Forwarded-Host. El login requiere además un desafío previo de diez minutos y un solo uso: cookie __Host Secure/HttpOnly/SameSite Strict y token en cabecera, emitido por JSON sin caché. Todas las escrituras autenticadas mantienen el token CSRF de la sesión. Los clientes API deben obtener GET /api/session/challenge y enviar su loginToken como X-Login-CSRF junto con la cookie antes de POST /api/session.

## Auditoría y actualización de seguridad

Consulta [SECURITY_AUDIT.md](SECURITY_AUDIT.md) antes de usar datos reales. La actualización de Vite y backend requiere `git pull --ff-only`, detener el servicio, `npm ci` y arrancar de nuevo. La cookie HTTPS usa ahora `__Host-focus_session`: vuelve a iniciar sesión. Para cambiar la contraseña de demo sin perder tareas ejecuta `FOCUS_DB=.data/demo.sqlite npm run password`; pide entrada oculta y revoca sus sesiones. No se sustituye la contraseña automáticamente.
