# Focus Hub — paquete Codex con subagentes

Versión revisada sobre los dos documentos originales del 15 de octubre de 2026. Se conserva el alcance completo de la v1, añadiendo orquestación explícita.

## Cómo usarlo

1. Crea un repositorio **privado** llamado `focus-hub`.
2. Copia el contenido de esta carpeta a la raíz (incluidas las carpetas ocultas `.codex/` y `.codex/agents/`).
3. Abre el repositorio con una versión actual de Codex y usa el contenido de `CODEX_START_HERE.md` como primera instrucción. Codex también leerá `AGENTS.md` como guía persistente.
4. Comprueba que el coordinador ha lanzado **subagentes reales** para la fase de descubrimiento y ha reunido sus conclusiones antes de editar archivos compartidos. Puedes examinar los hilos de subagentes en los clientes compatibles.
5. Primero valida compatibilidad actual de Sites, D1 y autenticación. Si algún requisito técnico no existe, conserva el producto y documenta la alternativa compatible antes de implementarla.
6. Mantén cualquier publicación, push remoto, importación de datos reales o integración de pago detrás de tu aprobación.

`.codex/config.toml` explicita que se permiten subagentes y limita a tres los subagentes concurrentes. Codex ya los suele habilitar por defecto. `.codex/agents/*.toml` define especialistas opcionales para fase de implementación: frontend, backend y QA.

Documentación: https://learn.chatgpt.com/docs/agent-configuration/subagents
