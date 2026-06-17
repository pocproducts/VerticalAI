# Proposal: Task System Decoupling — BaseTask + FullTask Rename + WS ARCA as Task

## Intent

`FullTask` is meaningless post-refactor (era "full pipeline" en la era single-task). WS ARCA SOAP (`arca_ws.py`) vive fuera de toda abstracción de task, forzando orquestación manual browser + API. Unificar todos los tipos de task bajo un protocolo `BaseTask` para que el orquestador pueda despacharlos uniformemente.

## Scope

### In Scope
- Renombrar `FullTask` → `VencimientosDeudasTask` (7 archivos fuente)
- `BaseTask` ABC: `name`, `timeout`, `parse_output()`, `execute()`
- `BrowserTask(BaseTask)`: mantiene campos Composio, hereda de BaseTask
- `ApiTask(BaseTask)`: para tasks SOAP/REST sin browser
- `PadronApiTask(ApiTask)`: wrapping `consultar_padron()` de `arca_ws.py`
- `PipelineStep`: runner liviano que despacha cualquier `BaseTask`

### Out of Scope
- Otros servicios WS ARCA (A13, etc.)
- WSAA Ticket de Acceso — caché y signing remain in `arca_ws.py`
- ComposioBrowser interno (session reuse, STOP_TASK, logging)
- Nuevas browser tasks (certificados, descargas)

## Capabilities

### New Capabilities
- `base-task`: protocolo abstracto `BaseTask` + jerarquía `ApiTask`
- `arca-ws-task`: `PadronApiTask` wrapping consulta SOAP A5

### Modified Capabilities
- `browser-task`: REQ-3 renombra `FullTask` → `VencimientosDeudasTask`
- `composio-browser-integration`: REQ-6 actualiza tipos referenciados + soporta `PipelineStep`

## Approach

1. **BaseTask** — ABC en `fiscal_agent/tasks/base.py` con `name`, `timeout`, `parse_output()`, `execute()`. Sin dependencia Composio.
2. **BrowserTask** — hereda `BaseTask`, retiene `template`, `secrets`, `start_url`, `needs_auth`. `execute()` delega al flujo create→watch de Composio.
3. **ApiTask** — hereda `BaseTask` para API calls síncronas. `execute()` corre la llamada SOAP/REST directamente.
4. **PadronApiTask** — wrapping `consultar_cuit()`; `execute()` retorna `PadronA5Output`. Input vía constructor o Pydantic model.
5. **PipelineStep** — dispatcher: `isinstance(task, ApiTask) → thread pool`; `isinstance(task, BrowserTask) → session Composio`.
6. **Rename** — `FullTask` → `VencimientosDeudasTask` en 7 archivos + docs.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `fiscal_agent/tasks/base.py` | New | `BaseTask`, `ApiTask`, `PipelineStep` |
| `fiscal_agent/tasks/padron.py` | New | `PadronApiTask` con execute() |
| `fiscal_agent/tasks/__init__.py` | New | Exports del paquete |
| `fiscal_agent/browser/task.py` | Modified | Rename `FullTask`, rebase `BrowserTask` → `BaseTask` |
| `fiscal_agent/browser/__init__.py` | Modified | Export `VencimientosDeudasTask` |
| `fiscal_agent/browser/composio.py` | Modified | Import rename, default task `VencimientosDeudasTask` |
| `fiscal_agent/cli.py` | Modified | Import + instantiation rename |
| `fiscal_agent/api/routes/extract.py` | Modified | `available_tasks` mapping rename |
| `fiscal_agent/mcp/tools/deuda.py` | Modified | Import + instantiation rename |
| `fiscal_agent/mcp/tools/report.py` | Modified | Import + instantiation rename |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Rename incompleto en 1+ archivo | Low | `grep FullTask` before/after + CI |
| WS ARCA no testeable offline | Low | Mockear respuestas SOAP para `PadronApiTask` |
| PipelineStep añade complejidad dispatch | Low | Runner mínimo: type matching only |

## Rollback Plan

Revert `task.py` + los 7 archivos de referencia. `BaseTask` + `ApiTask` son additivos (no rompen nada existente). `PadronApiTask` también additivo. Si el rename es problemático, revertir y mantener `FullTask` como alias.

## Dependencies

Ninguna externa. `ws_sr_constancia_inscripcion` SOAP ya funciona via `arca_ws.py`. `PadronApiTask` wrappea código existente, sin nuevas dependencias.

## Success Criteria

- [ ] `grep -r FullTask fiscal_agent/` count = 0 (renombrado completo)
- [ ] `BaseTask` ABC definido con `BrowserTask(BaseTask)` y `ApiTask(BaseTask)` subclases
- [ ] `PadronApiTask(cuit, cert, key, ...).execute()` produce same output que `consultar_padron()`
- [ ] `PipelineStep` corre lista mixta de `BrowserTask` + `ApiTask` sin error
- [ ] `cli.py deuda --with-padron` orquesta browser + API en un paso
- [ ] Todos los tests existentes pasan sin modificación
