# Tasks: Pipeline Timeout & Console Tracking

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~11 |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | Single PR |
| Delivery strategy | single-pr |
| Chain strategy | size-exception |

Decision needed before apply: Yes
Chained PRs recommended: No
Chain strategy: size-exception
400-line budget risk: Low

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Timeouts + Console tracking | PR 1 | Sin dependencias entre sí, paralelizables |

## Phase 1: Core Implementation

- [ ] **T-1.1** — `BrowserTask.timeout`: 120 → 300 (`task.py:173`)
- [ ] **T-1.2** — `FullTask.timeout`: 120 → 300 (`task.py:191`)
- [ ] **T-1.3** — `ExtractV2Task.timeout`: 120 → 300 (`task.py:247`)
- [ ] **T-1.4** — `FacilidadesTask.timeout`: 180 → 300 (`task.py:317`)
- [ ] **T-2.1** — En `_watch_task()`, tras `last_step = result.get('current_step', last_step)` (composio.py:276), insertar bloque que compara `current_step` contra `last_step` anterior y loggea via `logger.info('  ⏳ Task %s — Step %s: %s', task_id, current_step_val, step_desc[:200])` solo cuando cambia

## Phase 2: Verification

- [ ] Verificar que `FullTask().timeout == 300`, `ExtractV2Task().timeout == 300`, `FacilidadesTask().timeout == 300`
- [ ] Verificar que `_watch_task()` loggea cada cambio de step sin duplicar logs cuando el step no cambia

### Criterios de Aceptación

**T-1 (Timeouts):**
- `BrowserTask.timeout` es 300
- `FullTask.timeout` es 300
- `ExtractV2Task.timeout` es 300
- `FacilidadesTask.timeout` es 300
- `RegistroTask.timeout` sigue siendo 300 (no modificado)

**T-2 (Console tracking):**
- `_watch_task()` loggea `task_id`, número de step, y descripción cuando `current_step` cambia
- No produce logs duplicados cuando el step no cambia entre polls
- No altera la lógica de polling, timeout, ni la firma del método
- El log es visible en consola (logger.info)

### Dependencias

Ninguna. T-1 y T-2 son ortogonales y paralelizables — no comparten archivos ni lógica.
