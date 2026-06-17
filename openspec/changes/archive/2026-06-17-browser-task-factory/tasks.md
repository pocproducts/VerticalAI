# Tasks: Browser Task Factory

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~70-90 (additions + deletions) |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | Single PR |
| Delivery strategy | single-pr |

```
Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: Low
```

### Dependency Graph

```
factory.py ──> __init__.py ──> pipeline/service.py
                           ──> mcp/tools/deuda.py
                           ──> mcp/tools/facilidades.py
                           ──> mcp/tools/registro.py
```

All callers depend on `factory.py` being created and exported first. After that, all 4 callers can be migrated independently in any order.

## Phase 1: Foundation — Factory

- [x] 1.1 Create `fiscal_agent/browser/factory.py` with `build_browser_tasks()`:
  ```python
  """Browser task factory — centralized task construction."""
  from __future__ import annotations

  from fiscal_agent.browser.task import (
      FacilidadesTask, IIBBTask, RegistroTask, VencimientosDeudasTask,
  )
  from typing import List

  from fiscal_agent.browser.task import BrowserTask

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
      tasks: list[BrowserTask] = []
      if with_deuda:
          tasks.append(VencimientosDeudasTask(cuit=cuit, clave=clave, cliente_cuit=cliente_cuit))
      if with_facilidades:
          tasks.append(FacilidadesTask(cuit=cuit, clave=clave, cliente_cuit=cliente_cuit))
      if with_registro:
          tasks.append(RegistroTask(cuit=cuit, clave=clave, cliente_cuit=cliente_cuit))
      if with_iibb:
          tasks.append(IIBBTask(cuit=cuit, clave=clave, cliente_cuit=cliente_cuit))
      return tasks
  ```
- [x] 1.2 Update `fiscal_agent/browser/__init__.py` — add import for `build_browser_tasks` and include in `__all__`

## Phase 2: Core Implementation — PipelineService

- [ ] 2.1 Modify `fiscal_agent/pipeline/service.py` — replace inline imports (line 192) with `from fiscal_agent.browser import build_browser_tasks`
- [ ] 2.2 Replace lines 194-226 (if-flag task creation block) with single factory call:
  ```python
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

## Phase 3: Integration — MCP Tools

Each MCP tool follows the same pattern: replace import + inline construction with factory.

- [x] 3.1 `fiscal_agent/mcp/tools/deuda.py`:
  - Change import: `VencimientosDeudasTask` → `build_browser_tasks`
  - Replace lines 50-54 with: `tasks = build_browser_tasks(cuit=REPRESENTANTE_CUIT, clave=estudio_clave, cliente_cuit=cuit, with_deuda=True)`
  - Update `browser.run_single(None, tasks=[task])` to use `tasks` variable (already correct — `tasks` is a list now)
- [x] 3.2 `fiscal_agent/mcp/tools/facilidades.py` — same pattern with `with_facilidades=True`
- [x] 3.3 `fiscal_agent/mcp/tools/registro.py` — same pattern with `with_registro=True`

## Phase 4: Testing

- [ ] 4.1 Create `fiscal_agent/tests/test_browser_factory.py` — unit tests:
  - `test_empty_when_no_flags` — all flags False returns `[]`
  - `test_deuda_flag` — `with_deuda=True` returns `[VencimientosDeudasTask]`
  - `test_facilidades_flag` — `with_facilidades=True` returns `[FacilidadesTask]`
  - `test_all_flags` — all 4 True returns list of 4 in correct order
  - `test_constructor_args_passthrough` — verify cuit/clave/cliente_cuit propagate to tasks
- [ ] 4.2 Run full test suite: `python -m pytest fiscal_agent/tests/`

## Verification

```bash
# Unit tests
python -m pytest fiscal_agent/tests/test_browser_factory.py -v

# Full regression
python -m pytest fiscal_agent/tests/ -x

# Lint
ruff check fiscal_agent/browser/factory.py fiscal_agent/mcp/tools/{deuda,facilidades,registro}.py fiscal_agent/pipeline/service.py

# Type check (optional)
python -c "from fiscal_agent.browser.factory import build_browser_tasks; print('Import OK')"
```
