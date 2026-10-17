# Git: main y una única dev

Este es el flujo acordado para Focus. y sustituye las instrucciones anteriores
que pedían crear una rama o Pull Request por tarea.

| Rama | Uso |
|---|---|
| `main` | Versión estable; recibe integraciones de dev con aprobación del propietario. |
| `dev/focus-hub-v1.1-ux-readiness` | Única rama de desarrollo, a la que llamamos **dev**. Aquí se implementa, guarda y prueba todo el trabajo habitual. |

Se conserva el nombre de la rama que ya utiliza el proyecto. No hay que crear
otra rama llamada `dev`, ni ramas de funcionalidades, rebranding o agentes.
Los agentes pueden trabajar en paralelo sobre archivos diferentes dentro del
mismo checkout. No se crean worktrees para dividir el trabajo.

El rebranding del PR #4 ya está integrado en dev mediante `65e118b`. Las ramas
auxiliares de rebranding y Codespaces no tienen commits pendientes de integrar;
su contenido se conserva en el historial de dev. El PR #2 queda como revisión
para una futura integración en main; no hay que fusionarlo para seguir probando.

## Actualizar tu Codespace

Utiliza el Codespace actual para conservar tus datos y credenciales. En su
terminal, desde la carpeta del proyecto, pega:

```sh
git remote set-branches origin '*' &&
git fetch --prune origin &&
git switch dev/focus-hub-v1.1-ux-readiness &&
git merge --ff-only origin/dev/focus-hub-v1.1-ux-readiness
```

La primera línea normaliza qué ramas sigue tu copia local; no crea ramas ni
cambia la URL de GitHub. El fetch elimina referencias remotas obsoletas.
Los comandos no sobrescriben cambios locales. Si Git avisa de cambios pendientes
o de una divergencia, conserva la salida y pide ayuda; no uses `reset --hard`,
`clean` ni un cambio forzado de rama.

Después, recarga la aplicación. Con Vite los cambios del frontend se actualizan
automáticamente; las instrucciones de reinicio para cambios del backend están
en [CODESPACES.md](CODESPACES.md). Cambiar o actualizar esta rama no borra SQLite,
no cambia la contraseña y no requiere reconstruir el contenedor.

En futuras tareas Codex reutilizará esta misma dev, mantendrá main estable y
no realizará una integración en main sin autorización explícita. Nunca se hace
force push ni se reescribe el historial publicado.
