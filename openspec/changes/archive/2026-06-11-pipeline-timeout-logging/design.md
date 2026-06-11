# Design: Pipeline Timeout & Console Tracking

## Technical Approach

Two isolated, non-breaking changes:

1. **Timeouts** — cambiar el valor por defecto de `timeout` en 4 clases de `task.py` (la base y 3 subclases) de 120s/180s a 300s. Cambios de 1 línea cada uno.
2. **Console tracking** — insertar un bloque de logging en `_watch_task()` de `composio.py` que detecta cambios en `current_step` y los loggea en tiempo real. No toca la firma ni la lógica de polling.

Ningún cambio afecta la API pública (`ComposioBrowser.run_all()`, `ComposioBrowser.run_single()`, o las clases `BrowserTask`).

## Architecture Decisions

### Decision: Timeout en base class + subclasses

| Opción | Tradeoff | Decisión |
|--------|----------|----------|
| Cambiar solo el default de `BrowserTask` (120→300) y eliminar overrides redundantes | Menos líneas tocadas, pero rompe el principio de "cada task explicita su timeout" | Cambiar base + 3 subclases explícitamente |
| Cambiar solo las 3 subclases | La base queda en 120, inconsistente con REQ-1 del spec | Se cambia también `BrowserTask.timeout` para cumplir REQ-1 |

**Rationale**: REQ-1 especifica que `BrowserTask` (el protocol ABC) tiene timeout default 300. Las subclases que hoy overridean con 120 (FullTask, ExtractV2Task) o 180 (FacilidadesTask) se cambian a 300 explícitamente por claridad y por las REQ-TIMEOUT específicas.

### Decision: Logging antes de `last_step` update

| Opción | Tradeoff | Decisión |
|--------|----------|----------|
| Insertar logging ANTES de `last_step = result.get(...)` | Permite comparar contra el valor anterior | ✅ Se elige esta |
| Insertar después | Siempre da igual (ya se actualizó), requiere guardar old en variable temporal | Más código, igual resultado |

**Rationale**: El `current_step` recién llegado se compara contra `last_step` (el step anterior conocido). Si son distintos, se loggea y luego se actualiza `last_step`. Es el mínimo delta sobre el código existente.

### Decision: logger.info() en vez de console.print()

| Opción | Tradeoff | Decisión |
|--------|----------|----------|
| `logger.info()` | Sigue el patrón existente del módulo, respeta configuración de logging | ✅ |
| `console.print()` de Rich | No importado en composio.py, rompe consistencia | ❌ |

**Rationale**: Todo el módulo usa `logger.info/warning/error`. Usar Rich `console.print()` requeriría import adicional y rompe el patrón. El spec REQ-LOG-1 dice "loguear" sin especificar Rich.

## Data Flow

```
WatchTask polling loop (c/2s):
  POST BROWSER_TOOL_WATCH_TASK → { taskId, lastStepSeen }
  ↓
  Composio API response → { status, current_step, current_step_description?, ... }
  ↓
  ┌─ ¿current_step cambió? ─→ logger.info("Task X — Step N: desc")
  │                                ↓
  │                           last_step = current_step
  │                                ↓
  └─ status check ──→ finished/failed/stopped → return/raise
                          ↓
                     asyncio.sleep(2) → loop
```

No hay cambios en CREATE_TASK, STOP_TASK, ni en el pipeline de `_run_single()`.

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `fiscal_agent/browser/task.py` | Modify | 4 timeouts: BrowserTask 120→300, FullTask 120→300, ExtractV2Task 120→300, FacilidadesTask 180→300 |
| `fiscal_agent/browser/composio.py` | Modify | Insert logging block en `_watch_task()` para cambios de `current_step` |

## Interfaces / Contracts

Sin cambios en interfaces públicas. `_watch_task()` mantiene su firma:
```python
async def _watch_task(self, task_id: str, timeout: int = COMPOSIO_DEFAULT_TIMEOUT) -> dict[str, Any]
```

Las tareas `BrowserTask` mantienen su constructor y API pública. Solo cambia el valor por defecto de `timeout`.

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | Timeout defaults | Verificar `FullTask().timeout == 300`, `ExtractV2Task().timeout == 300`, `FacilidadesTask().timeout == 300` |
| Unit | Step change logging | Mock respuesta de API con/sin `current_step` y verificar que `logger.info` se llama solo cuando cambia |
| Integration | No regression | Ejecutar pipeline existente con datos de prueba — misma salida |

No se requieren tests E2E nuevos. Los tests existentes de `ComposioBrowser` deben seguir pasando sin modificación porque la lógica de polling y parseo no cambia.

## Migration / Rollout

No migration required. Rollback: `git checkout` de los dos archivos modificados.

## Open Questions

None.
