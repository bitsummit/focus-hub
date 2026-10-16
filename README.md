# Focus Hub

Aplicación privada de tareas, proyectos y diario con una única fuente de datos persistente. Interfaz en español; código TypeScript. Consulta [el plan técnico](docs/ARCHITECTURE.md) y [la especificación](FOCUS_HUB_CODEX_MASTER_PROMPT.md).

Capturas con datos ficticios: [escritorio](docs/screenshots/home-desktop.png) · [móvil](docs/screenshots/home-mobile.png).

## Probar en el navegador con Codespaces

Abre la [rama de entrega](https://github.com/bitsummit/focus-hub/tree/dev/focus-hub-v1-codespaces) y elige **Code → Codespaces → Create codespace**. La configuración instala, compila, crea una demo SQLite aislada y arranca automáticamente. Confirma **Private** en el puerto **3000** y pulsa **Open in Browser**.

En la terminal del Codespace ejecuta `code .data/demo-access.json` para consultar las credenciales aleatorias, que nunca se incluyen en Git. Sigue la [guía paso a paso de Codespaces](docs/CODESPACES.md) para acceso, reinicios y límites de verificación.

## Requisitos y ejecución privada

Node.js 24 o superior y npm. Usa el checkout existente; cada tarea cloud ya está aislada y no necesita crear otro worktree.

```sh
cd /workspace/focus-hub
npm ci --cache /workspace/.npm-cache
npm run build
npm run owner
npm start
```

`owner` solicita correo, nombre y contraseña (mínimo 12 caracteres, entrada oculta). Solo permite crear el propietario inicial: no existe registro público ni contraseña predeterminada. No introduzcas contraseñas en argumentos de línea de comandos ni en archivos versionados. El servidor escucha exclusivamente en la interfaz local, puerto 3000. La versión compilada se sirve desde el mismo proceso que la API. No se ha publicado ningún servicio.

La base de datos se crea automáticamente en `.data/focus-hub.sqlite` (ignorada por Git). `FOCUS_DB` permite elegir otra ruta; `PORT` cambia el puerto. Las migraciones se aplican sin borrar registros. Conserva la carpeta `.data` entre reinicios; no la uses como fixture. Para una copia de seguridad consistente, detén el servidor antes de copiar la base y sus archivos WAL, o usa una herramienta SQLite de backup. Nunca guardes datos privados en Git.

Para desarrollar con recarga automática, ejecuta `npm run dev`. Vite, la API y su WebSocket comparten el puerto privado 3000; no necesitas otra terminal, otro puerto ni recompilar el frontend. Los cambios de CSS se aplican al instante y los módulos del frontend se actualizan o recargan según corresponda. Los cambios del backend requieren reiniciar el proceso. `npm start` conserva el modo compilado y requiere `npm run build` previo. Codespaces usa el modo de desarrollo por defecto.

## Demo ficticia opcional

`npm run demo` crea una base **separada** en `.data/demo.sqlite`, con proyectos y tareas ficticios. Genera una contraseña aleatoria y guarda el acceso solo en `.data/demo-access.json` (permisos 0600, ignorado por Git). No sobrescribe una demo existente ni toca la base del propietario. Arranca con `FOCUS_DB=.data/demo.sqlite npm start` y consulta ese archivo local para iniciar sesión.

## Flujo de uso

- Captura una tarea con una línea y Enter. `!` indica prioridad alta, `!!` crítica y `#slug` enlaza un proyecto existente.
- Diario: escribe encabezados `# NombreProyecto`, notas, viñetas o tareas explícitas `- [ ]`. Las tareas guardadas se convierten en referencias estables; editarlas desde cualquier vista actualiza el mismo registro.
- Gestiona los siete estados en Kanban o tabla; las tareas en espera admiten persona y fecha de seguimiento. Completar conserva un historial; reabrir no borra logros anteriores.
- Selecciona hasta tres tareas de Hoy y cinco del foco semanal. El orden y el periodo se conservan.
- Crea proyectos, objetivos e hitos. El progreso estratégico se calcula únicamente con hitos logrados.
- Consulta Archivo y Mis avances para buscar el historial y revisar periodos. Ajustes permite cambiar zona horaria, tema y descargar JSON íntegro o CSV.

## Pruebas

```sh
npm test
npm run build
npm run test:e2e
```

Las pruebas usan cuentas y bases temporales ficticias, separadas de `.data/focus-hub.sqlite`. El navegador de pruebas utiliza Chromium; configura `CHROMIUM_PATH` si no está en `/usr/bin/chromium`. Resultados verificados: **17 pruebas API/calendario/seguridad y 5 pruebas Chromium aprobadas**, más compilación de producción. Consulta [la matriz de los 15 criterios](docs/ACCEPTANCE.md) para evidencia y límites. `npm run smoke:demo` comprueba autenticación y persistencia en una demo arrancada.

## Seguridad y portabilidad

Autenticación real con scrypt, sesiones aleatorias y cookies HttpOnly/SameSite, CSRF y comprobación de origen. Todas las operaciones se autorizan en el servidor por usuario y workspace; relaciones SQL y servicios impiden referencias cruzadas. No se confía en cabeceras de identidad ni en IDs del navegador como autoridad. La segunda cuenta existe solo en pruebas de aislamiento.

Los eventos son UTC; diario y foco usan fechas locales con zona IANA. Los periodos de métricas tienen final exclusivo. Completadas cuenta tareas distintas con eventos reales dentro del periodo; una tarea reabierta y completada de nuevo cuenta una sola vez en ese periodo, y puede contar en otro periodo si vuelve a completarse. El backlog histórico se reconstruye desde eventos. Las tareas canceladas no son logros.

JSON tiene versión de esquema e incluye identidades, relaciones, eventos, diarios, focos y preferencias del espacio autorizado, sin hashes de contraseña ni sesiones. No se ha implementado importación destructiva. CSV neutraliza caracteres que podrían ejecutarse como fórmulas al abrir hojas de cálculo.

## Sites / D1 / despliegue

Este entorno no expone herramientas, bindings ni autenticación de ChatGPT Sites. El proxy impidió consultar la documentación oficial (CONNECT 403). Por ello se implementa la alternativa local privada descrita en el plan, con almacenamiento SQLite real. **No se ha verificado un despliegue Sites, D1 alojado ni Sign in with ChatGPT.** No hay una URL pública o un despliegue externo.

Una migración futura debe aportar un adaptador D1 con operaciones atómicas/batch y un proveedor de identidad oficialmente verificado. El SQL relacional y los contratos de dominio se mantienen separados de las rutas y la UI. Exponer el servicio requiere una tarea de despliegue posterior: HTTPS, cookies Secure, copias de seguridad, control de acceso privado y aprobación del propietario. No conectar Notion, importar registros reales, publicar ni hacer push sin autorización.

## Seguridad y piloto privado

La primera auditoría interna y sus correcciones están en [docs/SECURITY_AUDIT.md](docs/SECURITY_AUDIT.md). Incluye actualización del Codespace, rotación de contraseña y riesgos pendientes. Antes de incorporar datos reales: contraseña fuerte, base personal separada y copia/restauración comprobada. El servidor Vite se mantiene para desarrollo con datos ficticios.
