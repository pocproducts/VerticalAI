# Proposal: Browser Task Factory

## Intent

Eliminate the duplicated browser task creation pattern spread across 4 locations. Each location independently imports task classes, checks flags, instantiates tasks with identical constructor args, and passes them to `run_single`. Any change to BrowserTask construction (new param, new subclass, constructor change) requires modifying all 4 files. A single factory function centralizes this.

## Scope

### In Scope
1. `fiscal_agent/browser/factory.py` — `build_browser_tasks(flags: dict, cuit: str, clave: str, cliente_cuit: str) → list[BrowserTask]`
   - Maps `with_deuda` → `VencimientosDeudasTask`, `with_facilidades` → `FacilidadesTask`, `with_registro` → `RegistroTask`, `with_iibb` → `IIBBTask`
   - Returns empty list when no flags set
2. CLI (`cli.py`): `_procesar_cliente_pipeline()` passes flags to factory instead of inline construction
3. PipelineService (`pipeline/service.py`): `run_pipeline()` uses factory
4. MCP tools (`deuda.py`, `facilidades.py`, `registro.py`): use factory (even single-task cases for consistency)

### Out of Scope
- Changes to `run_single` signature or execution logic
- Memory save logic (stays with callers, not factory)
- Changes to BrowserTask subclasses or their constructors
- Adding/removing browser task types

## Capabilities

> Pure refactor — no spec-level behavior change. No requirements added or modified.

### New Capabilities
None

### Modified Capabilities
None

## Approach

1. **Create** `fiscal_agent/browser/factory.py` exporting a single function:
   ```python
   def build_browser_tasks(
       with_deuda: bool = False,
       with_facilidades: bool = False,
       with_registro: bool = False,
       with_iibb: bool = False,
       cuit: str,
       clave: str,
       cliente_cuit: str,
   ) -> list[BrowserTask]:
   ```
2. **Replace** inline if-elif blocks in all 4 call sites with `build_browser_tasks(...)`.
3. **Additive only** — never delete old code paths until verified. After migration, inline imports in PipelineService (`from fiscal_agent.browser import ...Task`) become redundant; remove in same commit.
4. **Export** `build_browser_tasks` from `fiscal_agent/browser/__init__.py`.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `fiscal_agent/browser/factory.py` | **New** | Factory function consolidating task creation |
| `fiscal_agent/browser/__init__.py` | Modified | Export `build_browser_tasks` |
| `fiscal_agent/pipeline/service.py` | Modified | Lines 192-226 replaced with factory call |
| `fiscal_agent/cli.py` | Modified | `_procesar_cliente_pipeline` passes flags (already delegates to PipelineService — no direct change needed if PipelineService is the sole consumer) |
| `fiscal_agent/mcp/tools/deuda.py` | Modified | Line 50: replace inline `VencimientosDeudasTask(...)` with factory |
| `fiscal_agent/mcp/tools/facilidades.py` | Modified | Line 50: replace inline `FacilidadesTask(...)` with factory |
| `fiscal_agent/mcp/tools/registro.py` | Modified | Line 50: replace inline `RegistroTask(...)` with factory |

## Risks

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Breaking MCP tools if factory signature differs | Low | Factory uses same constructor args as existing call sites — pure mechanical extraction |
| PipelineService inline imports stale after refactor | Low | Remove unused imports in same commit after verifying factory works |
| Wrong flag mapping (e.g., `with_facilidades` creates wrong task) | Low | One-to-one mapping, same logic as current if-elif blocks |

## Rollback Plan

Revert the single commit. All changes are additive — old code paths coexist until verified. If an MCP tool breaks, the old inline code is still in git history for immediate recovery.

## Dependencies

- Diagnostic (Phase 2 dependency on Phase 1): The factory imports are used by PipelineService which was created in Phase 1 (`pipeline-service-extraction`). If that change is not merged, the PipelineService changes will conflict.

## Success Criteria

- [ ] All 4 call sites produce identical BrowserTask lists as pre-factory code (same task classes, same constructor args)
- [ ] `pytest fiscal_agent/tests/` passes without regression
- [ ] Each MCP tool (`extract_deuda`, `extract_facilidades`, `extract_registro`) creates the same single-task list as before
- [ ] PipelineService creates the same multi-task list for combined flag combinations
