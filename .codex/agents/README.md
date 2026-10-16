# Equipo de agentes de Focus Hub

Estos perfiles se han creado a partir de las responsabilidades de `AGENTS.md`,
`CODEX_START_HERE.md` y `FOCUS_HUB_CODEX_MASTER_PROMPT.md`. No son una recuperación
de archivos originales: `.codex/agents/` no estaba disponible en el repositorio.

`.codex/config.toml` registra cuatro roles con rutas relativas a sus archivos.
No fija modelos, credenciales ni permisos ampliados. El rol de seguridad solicita
un sandbox de solo lectura; los demás heredan los permisos y aprobaciones vigentes.

| Responsable | Alcance | Límite principal |
|---|---|---|
| Coordinador (agente principal) | Contratos, reparto, integración, auth, migraciones, dependencias y verificación final | Serializa cambios compartidos; conserva el trabajo existente |
| `frontend` | React, CSS, accesibilidad, móvil y estados de interfaz | Archivos frontend expresamente asignados |
| `backend` | Dominio, persistencia y endpoints conforme a contratos | Auth, esquema y contratos compartidos requieren asignación expresa |
| `qa` | Pruebas aisladas, regresiones y evidencia de aceptación | Datos ficticios; no modifica la aplicación sin reasignación |
| `security` | Revisión de amenazas, controles y hallazgos reproducibles | Solo lectura; propone correcciones al coordinador |

## Cómo trabajar

1. El coordinador lee las instrucciones del proyecto y concreta objetivo,
   archivos, dependencias, contrato, pruebas y formato de entrega de cada tarea.
2. Delega en paralelo únicamente trabajo independiente, sin propietarios de
   archivo solapados. No debe paralelizar dos suites sobre el mismo puerto.
3. Cada agente informa de lo ejecutado, evidencias, resultados y riesgos. El
   coordinador revisa e integra y ejecuta la verificación correspondiente.
4. En la próxima auditoría, `security` revisará en modo lectura; `qa` preparará
   reproducciones ficticias y el coordinador distribuirá las correcciones.
   Definir estos perfiles no significa que esa auditoría ya esté realizada.

Los clientes Codex compatibles cargan la configuración de proyecto cuando el
repositorio es de confianza; puede ser necesario iniciar una sesión nueva.
Guardar TOML en GitHub no instala Codex en Codespaces ni activa por sí solo agentes.
Si el runtime no permite seleccionar roles personalizados, el coordinador debe
leer el perfil y transmitir sus instrucciones al subagente nativo, respetando sus
límites, e indicar esa limitación. No debe afirmar que un perfil se cargó o que se
usó un agente cuando no haya ocurrido.

Los permisos efectivos del runtime prevalecen. La configuración no habilita pushes,
publicación, acceso a datos reales, integraciones ni costes. La autorización del
usuario en la tarea concreta sigue siendo necesaria para esas acciones.

Referencia del formato: [esquema oficial de Codex](https://github.com/openai/codex/blob/main/codex-rs/core/config.schema.json).
