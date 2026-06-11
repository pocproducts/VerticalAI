# Proposal: browser-task-orchestrator

## Intent

`_run_single()` ejecuta 1 task con `TEMPLATE_FULL` (login+switch+extract en 1 instrucción NL). Limita: separar responsabilidades, reusar sesión entre tasks, y agregar nuevas tareas sin tocar el orquestador.

Refactor: cada operación de navegación = `BrowserTask` autónomo; `ComposioBrowser` orquesta N tasks reusando la misma sesión Composio.

## Scope

### In Scope
- `BrowserTask` protocol/ABC con `execute(session_id) → TaskResult`
- Refactor `composio.py`: loop multi-task por sesión, reuso de `sessionId`
- `FullTask` wrapper para `TEMPLATE_FULL` (compatibilidad)
- `_run_single()` y `run_single()`/`run_all()` usan el nuevo orquestador

### Out of Scope
- Nuevas tasks específicas (certificados, planes de pago)
- Modelos, `cli.py`, `pdf_generator.py`
- Tests, CI, infraestructura

## Capabilities

### New Capabilities
- `browser-task`: definición de `BrowserTask` y su ciclo de vida (create→watch→stop, session reuse)

### Modified Capabilities
- `composio-browser-integration`: REQ-1 cambia de "1 task por cliente" a "N tasks por sesión"

## Approach

1. **Protocol**: `BrowserTask(ABC)` con `execute(session_id, http) → TaskResult`
2. **Orquestación**: `_run_single()` itera lista de `BrowserTask`, comparte `session_id`, ejecuta create→watch→parsing secuencial
3. **Compatibilidad**: `FullTask(TEMPLATE_FULL)` = BrowserTask que ejecuta el template actual. `run_all()` usa `[FullTask()]` por defecto
4. **Resultado**: `TaskResult` con `raw_output`, `parsed_data`, `arca_error`. Orquestador consolida en `DeudaOutput`

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `fiscal_agent/browser/task.py` | New | BrowserTask ABC + FullTask + TaskResult |
| `fiscal_agent/browser/composio.py` | Modified | _run_single multi-task; receive session_id opcional |
| `fiscal_agent/browser/workflows/__init__.py` | Modified | Export FullTask si aplica |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Session expira entre tasks | Med | Tasks <120s c/u; timeout global |
| sessionId no funciona entre CREATE_TASK | Low | Verificar; fallback 1 task/sesión |
| Regresión pipeline productivo | Low | FullTask produce mismo DeudaOutput |

## Rollback Plan

Revert `composio.py`, borrar `task.py`, restaurar `workflows/__init__.py`. `_run_single()` vuelve a TEMPLATE_FULL. Sin cambios en datos ni CLI.

## Dependencies

Ninguna externa. Depende de que Composio preserve `sessionId` entre CREATE_TASK consecutivos.

## Success Criteria

- [ ] `run_all()` con `[FullTask()]` produce outputs idénticos a `main`
- [ ] `_run_single()` ejecuta 2+ BrowserTask secuenciales reusando `session_id`
- [ ] `run_single()` funciona sin cambios desde `cli.py`

## Estimación

~3 archivos, ~200-280 líneas totales. Dentro del budget de 400.
