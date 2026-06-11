# Proposal: pipeline-timeout-logging

## Intent

Timeouts de 120s en BrowserTasks causan fallos en extracción de deuda cuando ARCA responde lento o el AI agent navega pasos extra. Además no hay visibilidad del progreso del AI agent de Composio durante ejecución — el usuario ve solo "finished/failed/stopped" sin saber en qué step está.

## Scope

### In Scope

- Aumentar timeout default a 300s en `FullTask`, `ExtractV2Task`, `FacilidadesTask`
- Console tracking en `_watch_task()`: loguear cada cambio de `current_step` del AI agent en vivo
- Delta specs: actualizar browser-task y composio-browser-integration con nuevos defaults

### Out of Scope

- Flags CLI para timeout configurable por usuario
- Cambios en pipeline orchestration (`cli.py`), email, PDF
- Retry logic o reintentos automáticos
- NFR timeout targets en specs existentes

## Capabilities

### New Capabilities

None

### Modified Capabilities

- `browser-task`: timeout default de 120s → 300s en FullTask, ExtractV2Task, FacilidadesTask
- `composio-browser-integration`: console tracking del `current_step` del AI agent en `_watch_task()`

## Approach

1. **task.py**: cambiar `timeout = 120` a `timeout = 300` en FullTask (`task.py:191`), ExtractV2Task (`task.py:247`), FacilidadesTask (`task.py:317`). Cambio de una línea cada uno.
2. **composio.py**: en `_watch_task()`, almacenar `last_step` y comparar con `current_step` entrante. Cuando cambia, loguear vía `console.print(f"[bold]Step[/bold] {current_step}")` y/o `logger.info()`. Sin tocar lógica de polling ni timeout.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `fiscal_agent/browser/task.py` | Modified | Timeout defaults: FullTask 120→300, ExtractV2Task 120→300, FacilidadesTask 180→300 |
| `fiscal_agent/browser/composio.py` | Modified | `_watch_task()`: loguear `current_step` changes al usuario |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Pipeline tarda 5min en fallar si algo va mal | Low | STOP_TASK en `finally` corta sesión igual. No empeora la experiencia actual |
| Console tracking agrega ruido visual | Low | Log por step nuevo; típicamente 3-5 pasos por task. Info útil para debugging |

## Rollback Plan

`git checkout` de `fiscal_agent/browser/task.py` y `fiscal_agent/browser/composio.py`. Sin migraciones ni cambios de esquema.

## Dependencies

Ninguna. Cambios autónomos sin nuevas dependencias.

## Success Criteria

- [ ] `FullTask.timeout == 300`, `ExtractV2Task.timeout == 300`, `FacilidadesTask.timeout == 300`
- [ ] `_watch_task()` loggea `current_step` al usuario en cada cambio de step
- [ ] Pipeline de extracción con datos reales no timeoutea en ventana de 5min
