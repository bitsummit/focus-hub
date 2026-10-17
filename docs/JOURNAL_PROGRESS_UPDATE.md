# Diario continuo y navegación de Avances · 17 de octubre de 2026

## Cambios

- Títulos y navegación: **Tareas, Tu espacio, Diario, Avances**. «Avances» mantiene
  un nombre breve, coherente con Tareas/Diario. Inglés: Tasks, Your workspace,
  Journal, Progress. Se actualizan también la sección y el enlace del dashboard.
- `/journal` muestra las entradas guardadas, por fecha descendente, con contenido
  completo y un máximo de **15 días por página**. Hay búsqueda y paginación; la
  página se conserva en la URL y tras recargar. No se inventan días vacíos.
- **Nueva entrada** abre hoy; el calendario permite otra fecha. Una fecha aparece
  en la lista cuando se guarda contenido. `/journal/AAAA-MM-DD` conserva el editor
  diario y sus enlaces desde proyectos/Archivo, con un acceso de vuelta a entradas.
- Notas y tareas del listado reutilizan los componentes originales: las notas se
  editan directamente y las tareas mantienen su identidad, estado e histórico.
  No se crean copias de tareas al mostrarlas en el diario.
- Avances: ambas flechas permanecen alineadas en móvil, con fechas que pueden
  ocupar dos líneas y zona horaria debajo. Se mantiene el cálculo de intervalos
  semanales/mensuales y sus límites exclusivos originales.
- Los fallos al cargar estadísticas terminan la carga y ofrecen **Reintentar**;
  el mensaje se limpia al recuperarse. Los errores globales de refresco se separan
  de los errores de escritura: recuperar la conexión no oculta una edición fallida.
- En gráficos mensuales móviles se espacian las etiquetas visibles de días para
  evitar solapamientos. Siguen disponibles todos los valores en la tabla accesible;
  no se modifican estadísticas ni fórmulas. Tooltip traducido en ambos idiomas.

No hay migración, cambios de API, nuevas dependencias, cambios de credenciales o
modificación de la base existente. La paginación limita las entradas renderizadas;
la API sigue proporcionando el snapshot completo. No se introduce paginación del
servidor ni se cambia la arquitectura en esta iteración.

## Validación

Pruebas con cuentas ficticias y bases temporales. Dos subagentes reales participaron:
responsive/revisión y QA; el coordinador integró App, traducciones y estados de error.
Los perfiles pertinentes de `.codex/agents/` se aplicaron como instrucciones.

Los escenarios nuevos verifican:

1. Abrir una fecha sin crear una entrada vacía; guardar 16 días y ver 15 + 1,
   ordenados, con paginación que sobrevive a recarga.
2. Editar una nota desde el listado; cambiar y completar una tarea canónica,
   conservando un único registro/evento y su reflejo en el editor diario/Archivo.
3. Lista y encabezado legibles a 360/390 px, sin overflow global.
4. Semana/mes anterior y siguiente al cruzar diciembre/enero; flechas alineadas
   a 360/390 px también en inglés y oscuro.
5. Fallo 503 en estadísticas, salida del loader y reintento correcto. Fallo de
   refresco general, banner, reintento y retirada del mensaje al recuperarse.

La revisión visual detectó y corrigió la compresión del título del diario móvil.
Se ajustó además el helper de login de pruebas para exigir exactamente «Tareas»,
sin confundirlo con el texto de la pantalla de acceso.

## Probar en Codespaces

Actualizar la rama privada `dev/focus-hub-v1.1-ux-readiness`, preservando antes
cualquier cambio local:

```sh
git fetch origin dev/focus-hub-v1.1-ux-readiness:refs/remotes/origin/dev/focus-hub-v1.1-ux-readiness
git switch dev/focus-hub-v1.1-ux-readiness
git merge --ff-only origin/dev/focus-hub-v1.1-ux-readiness
```

Si se ejecuta Vite (`npm run dev` / autoarranque de Codespaces), no hace falta
compilar, reinstalar ni reiniciar: esta iteración cambia solo frontend. Para un
servidor compilado (`npm start`), recompilar antes de reiniciarlo. Mantener puerto
3000 privado. Sin despliegue público, importaciones, force push ni merge a main.

## Resultado final

**56/56 pruebas de lógica/backend**, **17/17 E2E en Chromium** (1,4 minutos),
compilación TypeScript/Vite correcta y utilidad de capturas verificada.
[Evidencia](validation/journal-progress/test-results.txt).

Capturas ficticias revisadas: [diario continuo móvil](screenshots/journal-progress/journal-feed-mobile.png)
y [Avances móvil](screenshots/journal-progress/progress-mobile.png).
