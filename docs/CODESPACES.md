# Probar Focus Hub en GitHub Codespaces

Esta entrega conserva la v1: React/TypeScript, servidor Node, SQLite persistente y autenticación real. El entorno es de desarrollo con datos ficticios; no es un despliegue público ni de producción. No requiere instalar herramientas en tu ordenador.

## 1. Abrir el entorno desde el navegador

1. Inicia sesión en GitHub con la cuenta que tiene acceso al [repositorio privado](https://github.com/bitsummit/focus-hub).
2. Abre la [rama de entrega](https://github.com/bitsummit/focus-hub/tree/dev/focus-hub-v1-codespaces). Confirma que el selector de rama muestra **dev/focus-hub-v1-codespaces**; `main` conserva la versión anterior hasta revisar e integrar el PR.
3. Pulsa **Code → Codespaces → Create codespace on dev/focus-hub-v1-codespaces**. Si GitHub muestra **New with options**, selecciona esa rama y `.devcontainer/devcontainer.json`. Bastan 2 CPU y 4 GB de RAM.
4. Espera a que termine la creación. Automáticamente se ejecutan `npm ci`, la compilación, la creación inicial de la demo y el arranque. El proceso termina comprobando login, datos persistentes y referencias del diario. No se imprimen contraseñas.
5. Abre la pestaña **Ports / Puertos** del panel inferior. Debe aparecer **3000 · Focus Hub · privado**. Comprueba que **Port Visibility / Visibilidad del puerto** es **Private**. Es el valor predeterminado de GitHub para un puerto nuevo. No elijas `Public` ni `Private to Organization`.
6. Pulsa el icono **Open in Browser / Abrir en el navegador** de la fila 3000. GitHub puede pedirte autenticarte para acceder al puerto privado. La dirección externa usa HTTPS aunque la conexión interna del contenedor sea HTTP.

La configuración no solicita accesibilidad pública. La visibilidad pertenece a GitHub Codespaces y no tiene una propiedad estándar en el esquema devcontainer para fijarla: se usa el valor predeterminado privado y se verifica en **Ports**. Si reutilizas un Codespace en el que hubieras cambiado antes la visibilidad, restáurala a **Private** antes de abrirlo. Si dispones de GitHub CLI autenticado, también puedes ejecutar `gh codespace ports visibility 3000:private --codespace "$CODESPACE_NAME"`.

Si no aparece 3000, ejecuta en la terminal de Codespaces:

```sh
bash .devcontainer/start.sh
```

El comando es idempotente y no duplica el servidor. Puedes consultar `.data/codespaces-server.log` si falla. No se detienen procesos ajenos que ocupen el puerto.

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

## 4. Reanudar, recompilar y seguir desarrollando

Para volver a entrar, visita GitHub → Codespaces y abre el Codespace existente. `postStartCommand` reinicia el servicio si hace falta. No crees otro por accidente si deseas conservar las pruebas.

Para detener el servicio y recompilar después de editar código:

```sh
node .devcontainer/service.mjs stop
npm run build
bash .devcontainer/start.sh
```

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
