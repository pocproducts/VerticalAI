# Proposal: Pipeline Service Extraction

## Intent

Extract pipeline orchestration from `cli.py` into a dedicated `PipelineService` so CLI, API, and MCP share one service layer instead of importing from a CLI file. CLI changes must never risk production.

Resolves issues #1 (CLI as orchestrator), #3 (parallel `deuda`), #5 (raw `dict`), #6 (duplicated constants).

## Scope

### In Scope
1. Create `fiscal_agent/pipeline/` with `service.py`, `models.py`, `__init__.py`
2. `PipelineService.run_pipeline()` — logic from `_procesar_cliente_pipeline()`
3. `PipelineResult` Pydantic model — typed replacement for raw `dict`
4. Move `CERT_PATH`, `REPRESENTANTE_CUIT` to `config.py`
5. CLI `run`/`report` delegate to `PipelineService`
6. API + MCP import `PipelineService` instead of `cli`
7. Keep `_procesar_cliente_pipeline()` as backward-compatible wrapper

### Out of Scope
Browser factory, memory cleanup, auth, TA cache unification, browser extraction dedup — all future phases.

## Capabilities

None — pure refactor with no spec-level behavior changes.

## Approach

**Additive**: `_procesar_cliente_pipeline()` becomes a thin wrapper calling `PipelineService.run_pipeline()`.

1. `PipelineResult(BaseModel)` mirrors current dict fields with proper types.
2. `PipelineService.__init__()` accepts engine, pdf_gen, memory_client, etc. `run_pipeline()` exposes the same signature minus `echo_func` (callback).
3. `CERT_PATH`/`KEY_PATH`/`REPRESENTANTE_CUIT` unified in `config.py`.
4. CLI, API, MCP import from `pipeline.service` and `config` instead of `cli`.

## Affected Areas

| Area | Change |
|------|--------|
| `fiscal_agent/pipeline/` | **New** — `service.py`, `models.py`, `__init__.py` |
| `fiscal_agent/config.py` | **Modified** — add `CERT_PATH`, `REPRESENTANTE_CUIT` |
| `fiscal_agent/cli.py` | **Modified** — delegate to `PipelineService`, remove local constants |
| `fiscal_agent/api/deps.py` | **Modified** — remove local constants (use `config`) |
| `fiscal_agent/api/routes/chat.py` | **Modified** — import from `pipeline.service` |
| `fiscal_agent/api/routes/report.py` | **Modified** — import from `pipeline.service` |
| `fiscal_agent/mcp/tools/pipeline.py` | **Modified** — import from new locations |
| 6 MCP tools (`deuda.py`, etc.) | **Modified** — import `REPRESENTANTE_CUIT` from `config` |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Breaking API consumers parsing dict fields | Medium | `PipelineResult` keeps same field names; wrapper returns identical `dict` |
| Memory saves as side effects inside pipeline | Medium | Keep same control flow — no behavioral change |
| `report` vs `run` output_dir divergence | Low | Document as optional param in service |
| MCP tools with `None` client | Low | Same null-safety as current code |

## Rollback Plan

`git revert` the PR + delete `fiscal_agent/pipeline/`. The wrapper preserves the original import graph — reverting immediately restores the old code paths.

## Dependencies

None.

## Success Criteria

- [ ] CLI `run` + `report` produce identical output vs. current code
- [ ] API `POST /v1/report` returns identical response
- [ ] MCP `run_pipeline` returns identical `UnifiedResponse`
- [ ] All existing tests pass unmodified
- [ ] `REPRESENTANTE_CUIT`/`CERT_PATH` come from `config.py`, not `cli.py` or `api/deps.py`
- [ ] `_procesar_cliente_pipeline()` works as thin wrapper
