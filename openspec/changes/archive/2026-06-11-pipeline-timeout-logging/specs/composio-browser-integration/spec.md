# Delta for composio-browser-integration

## ADDED Requirements

### REQ-7: Console Tracking en _watch_task()

`_watch_task()` MUST loguear en tiempo real cada cambio de `current_step` del AI agent de Composio durante la ejecución de una tarea.

MUST:
- Almacenar el último `current_step` conocido y comparar con cada respuesta del polling loop
- Cuando `current_step` cambia, loguear via `console.print()` y/o `logger.info()`
- Incluir en el log: `task_id`, número de step, y descripción del paso
- NO interferir con el polling loop ni la lógica de timeout
- NO cambiar la firma de `_watch_task()`

#### Scenario: Step progression logged

- GIVEN una tarea Composio en ejecución con múltiples pasos
- WHEN el AI agent avanza de un step a otro
- THEN se loggea el nuevo step con task_id, step number, y descripción
- THEN el polling loop continúa sin interrupción

#### Scenario: Step sin cambios (no duplica logs)

- GIVEN una tarea donde `current_step` permanece igual entre polls
- WHEN `_watch_task()` recibe respuesta sin cambio de step
- THEN no se produce log del mismo step repetido
- THEN el comportamiento del polling loop es idéntico al actual
