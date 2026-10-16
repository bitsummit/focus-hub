# Prompt para iniciar Focus Hub en Codex / ChatGPT Sites

## Instrucción especial: ejecutar Focus Hub con un equipo de subagentes

**Usa realmente la función de subagentes de Codex.** Tú eres el agente coordinador y debes delegar trabajo en paralelo cuando las tareas sean independientes. No basta con simular varios roles en un único hilo de chat.

- Lee el documento maestro y el `AGENTS.md` del repositorio. Asegúrate de que la configuración de subagentes está disponible. Si no lo está, explica la limitación.
- Para la fase 0, lanza hasta **tres subagentes en paralelo** que revisen respectivamente: (1) viabilidad de Sites/D1/autenticación/despliegue, (2) arquitectura de datos/seguridad, y (3) producto/UX/pruebas de aceptación. Espera a recibir los resultados y consolida un plan técnico coherente.
- A partir de la fase 1, define primero contratos comunes (modelo de datos, APIs, tipos, autenticación); después delega tareas independientes a los agentes frontend, backend y QA. El coordinador mantiene la integración y la responsabilidad final.
- Da a cada agente alcance concreto, archivos o módulos de su propiedad y criterios de aceptación. Evita que dos agentes editen simultáneamente los mismos archivos o migraciones. Si no hay independencia suficiente, trabaja secuencialmente.
- Valida las entregas de cada agente con pruebas reales antes de pasar de fase y explica qué se ha delegado efectivamente, qué se ha integrado y qué sigue pendiente.
- Conserva el alcance completo de la v1 y las 15 pruebas de aceptación. No reemplaces la persistencia real por datos de muestra, no importes datos privados, no publiques el servicio ni empujes cambios remotos sin autorización.

Quiero que construyas **Focus Hub**, una aplicación web full-stack de gestión personal de tareas y proyectos. He adjuntado `FOCUS_HUB_CODEX_MASTER_PROMPT.md` y constituye la especificación funcional y técnica de referencia: **léela entera antes de comenzar**.

Usa ChatGPT Sites con almacenamiento relacional persistente D1 y autenticación de usuarios, si el runtime actual lo admite. Comprueba la documentación oficial actual; elige el starter compatible, sin imponer frameworks que Sites no soporte. Guarda el código en Git con migraciones, tests y documentación.

No quiero una maqueta ni una simple lista de tareas. La primera versión funcional debe incluir captura de una línea, prioridades, diario con tareas vinculadas, Kanban, tabla, estados diferenciados, foco diario y semanal, objetivos e hitos estratégicos, proyectos activos, histórico de finalizaciones y estadísticas reales. Todo debe compartir una única fuente de datos.

Prepara primero un plan técnico breve y la lista de fases y empieza a implementarlo. Verifica persistencia y sincronización entre vistas. Usa solo datos ficticios para demo, mantén el despliegue privado y no conectes a Notion ni publiques públicamente sin mi autorización.

Al finalizar, entrégame un prototipo privado funcional, instrucciones claras de uso y una relación de los criterios de aceptación verificados y pendientes. Cuando necesites permisos, cuentas o secretos, solicítamelos en ese punto; para el resto toma decisiones técnicas razonables y sigue adelante.
