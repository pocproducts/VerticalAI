# Design: Browser Task Factory

## Technical Approach

Extract the duplicated `if flag: tasks.append(TaskClass(...))` blocks into a single pure function. The factory lives in `fiscal_agent/browser/factory.py`, accepts keyword-only boolean flags and shared constructor args, and returns a `list[BrowserTask]`. All 4 call sites replace inline construction with a one-line call.

The function is **pure**: no I/O, no secrets resolution (callers pass `clave`), no database — just conditional instantiation. Callers keep memory save logic and error handling; the factory owns only the mapping.

## Architecture Decisions

| Option | Tradeoff | Decision |
|--------|----------|----------|
| Flags as `**kwargs` dict vs keyword args | Dict is flexible but loses type safety; keyword args are self-documenting | **Keyword-only bool args** — matches existing call-site style, IDE autocomplete works |
| Factory as method on `ComposioBrowser` vs standalone function | Method couples task creation to browser lifecycle; standalone is composable and testable | **Standalone function** — no dependency on runtime state, callers that don't use browser (e.g. dry-run) can still build task lists |
| Import task classes inside factory vs at module top | Inside avoids circular imports; top is cleaner but risk | **Module-level imports** — `factory.py` has no circular dependency risk (it imports task definitions, not browser or pipeline modules) |
| Preserve flag order or use flag-name order | PipelineService uses order: deuda → facilidades → registro → iibb | **Flag-name order** (alphabetical: deuda → facilidades → iibb → registro) is arbitrary; **preserve existing order**: deuda → facilidades → registro → iibb |

## Interface / Contract

```python
# fiscal_agent/browser/factory.py

def build_browser_tasks(
    cuit: str,
    clave: str,
    cliente_cuit: str,
    *,
    with_deuda: bool = False,
    with_facilidades: bool = False,
    with_registro: bool = False,
    with_iibb: bool = False,
) -> list[BrowserTask]:
```

## Flag-to-Task Mapping

| Flag | Task Class | Constructor Args | Notes |
|------|-----------|-----------------|-------|
| `with_deuda` | `VencimientosDeudasTask` | `cuit, clave, cliente_cuit` | Same as `FullTask` alias |
| `with_facilidades` | `FacilidadesTask` | `cuit, clave, cliente_cuit` | |
| `with_registro` | `RegistroTask` | `cuit, clave, cliente_cuit` | |
| `with_iibb` | `IIBBTask` | `cuit, clave, cliente_cuit` | |

Task **order** in returned list: `[deuda, facilidades, registro, iibb]` — matches PipelineService's existing iteration order.

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `fiscal_agent/browser/factory.py` | **Create** | `build_browser_tasks()` — pure mapping function |
| `fiscal_agent/browser/__init__.py` | **Modify** | Export `build_browser_tasks` |
| `fiscal_agent/pipeline/service.py` | **Modify** | Lines 192-226: replace inline if-flag block with factory call; remove inline imports |
| `fiscal_agent/mcp/tools/deuda.py` | **Modify** | Line 13: change import; line 50: replace `VencimientosDeudasTask(...)` with factory |
| `fiscal_agent/mcp/tools/facilidades.py` | **Modify** | Line 13: change import; line 50: replace `FacilidadesTask(...)` with factory |
| `fiscal_agent/mcp/tools/registro.py` | **Modify** | Line 13: change import; line 50: replace `RegistroTask(...)` with factory |

## Caller Migration Strategy

Each caller follows the same pattern:

**PipelineService** (previous lines 192-226):
```python
# Before
from fiscal_agent.browser import FacilidadesTask, IIBBTask, RegistroTask, VencimientosDeudasTask
tasks = []
if with_deuda:
    tasks.append(VencimientosDeudasTask(cuit=..., clave=..., cliente_cuit=...))
if with_facilidades:
    tasks.append(FacilidadesTask(cuit=..., clave=..., cliente_cuit=...))
# ... etc

# After
from fiscal_agent.browser import build_browser_tasks
tasks = build_browser_tasks(
    cuit=REPRESENTANTE_CUIT,
    clave=estudio_clave,
    cliente_cuit=cliente.cuit,
    with_deuda=with_deuda,
    with_facilidades=with_facilidades,
    with_registro=with_registro,
    with_iibb=with_iibb,
)
```

**MCP tool** (e.g. deuda.py):
```python
# Before
from fiscal_agent.browser import VencimientosDeudasTask
task = VencimientosDeudasTask(cuit=REPRESENTANTE_CUIT, clave=estudio_clave, cliente_cuit=cuit)

# After
from fiscal_agent.browser import build_browser_tasks
tasks = build_browser_tasks(
    cuit=REPRESENTANTE_CUIT, clave=estudio_clave, cliente_cuit=cuit, with_deuda=True
)
```

Note: CLI `_procesar_cliente_pipeline()` already delegates to PipelineService — **no change needed** in `cli.py`.

## Verification Plan

| Check | Method | Criteria |
|-------|--------|----------|
| Factory produces same tasks | Unit test | Call `build_browser_tasks(with_deuda=True)` → returns `[VencimientosDeudasTask]` with matching constructor args |
| All flags produce length-4 list | Unit test | `build_browser_tasks(..., with_deuda=True, with_facilidades=True, with_registro=True, with_iibb=True)` → len 4, types match order |
| No flags returns empty | Unit test | Empty list when all flags False |
| MCP tools still construct correct type | Snapshot / type-check | Each MCP tool's `tasks[0]` is the expected BrowserTask subclass |
| PipelineService multi-task | Integration | Combined flag combinations produce same iteration behavior as pre-factory code |
| No regression | `pytest` | All existing tests pass with same behavior |

## Open Questions

None — mapping is purely mechanical, all edge cases surfaced by proposal review.
