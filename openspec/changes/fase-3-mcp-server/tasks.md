# Tasks: Fase 3 — MCP Server

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~566 |
| 400-line budget risk | Medium |
| Chained PRs recommended | No |
| Suggested split | single PR |

**Justification**: ~566 lines is 41% over the 400-line review budget, but the risk is Medium, not High. Reason: 9 of 13 files are tool files (`calendar.py`, `taxpayer.py`, etc.) that follow an identical pattern (wrapping existing logic, same `UnifiedResponse` envelope, same `ctx.request_context.lifespan_context` service access, same `try/except` error structure). Once a reviewer has seen one tool, the others are mechanical. The truly novel code lives in `server.py` (lifespan context) and `transport.py` (auth middleware). A single PR with an accurate commit message and clear file ordering keeps review effort proportional.

---

## Phase 1: Foundation — Package + Server Skeleton + Transport

This phase creates the `mcp/` package, the FastMCP server with lifespan context, and the transport dispatcher. It is the skeleton that all tools attach to.

- [x] **1.1 Create `fiscal_agent/mcp/__init__.py`** — Empty package marker.
- [x] **1.2 Create `fiscal_agent/mcp/server.py`** — FastMCP app named `"fiscal-agent"` with:
  - `lifespan` context factory: initialize `RulesEngine`, `PdfGenerator`, TA cache via `deps.get_ta()`, and `ComposioBrowser` (only if `COMPOSIO_API_KEY` env is set, else `None`).
  - `lifespan_context` typed dict exposing `engine`, `pdf_gen`, `ta_cache`, `browser`.
  - Import and register all 9 tool functions via `mcp.tool()` decorator calls.
  - Export `mcp` app instance for transport layer.
- [x] **1.3 Create `fiscal_agent/mcp/transport.py`** — Transport dispatcher + HTTP auth middleware:
  - `run_mcp()` function that reads `MCP_TRANSPORT` env var.
  - Default `"stdio"`: calls `mcp.run(transport="stdio")` — no auth, no network.
  - `MCP_TRANSPORT=http`: wraps `mcp.sse_app()` in a Starlette app with middleware.

### HTTP Auth Middleware (in transport.py)

- Before routing to `mcp.sse_app()`, intercept requests and validate `Authorization: Bearer <api_key>` against `resolve_api_key()` from `api/store.py`.
- Map tool name → required scope:
  - `health` → public (skip auth).
  - `get_calendar`, `match_rentas_cordoba` → `calendar:read`.
  - `get_taxpayer`, `extract_deuda`, `extract_facilidades`, `extract_registro` → `taxpayer:read`.
  - `get_report_pdf` → `report:read`.
  - `run_pipeline` → `report:write`.
- Missing key → 401. Valid key + missing scope → 403.
- Reuse `Scope` enum from `models.py` (already has `CALENDAR_READ`, `TAXPAYER_READ`, `REPORT_READ`, `REPORT_WRITE`).
- Return `UnifiedResponse(status="error", error=ApiError(...)).model_dump()` as JSON body on failures.

---

## Phase 2: Simple Tools — Calendar + Taxpayer + Health

These tools depend only on `RulesEngine` and ARCA Web Services. No browser needed.

- [x] **2.1 Create `fiscal_agent/mcp/tools/__init__.py`** — Empty package marker for tools subpackage.
- [x] **2.2 Create `fiscal_agent/mcp/tools/health.py`** — `health` tool:
  - No parameters.
  - Reads `ta_cache` from lifespan context.
  - Returns `UnifiedResponse` with `{"status": "ok", "timestamp": "...", "ta_vigente": bool}`.
  - Pure liveness check, always succeeds.
  - Public scope in HTTP mode (no auth required).
- [x] **2.3 Create `fiscal_agent/mcp/tools/calendar.py`** — `get_calendar` tool:
  - Parameters: `cuit: str` (required), `mes: int` (optional, default current), `anio: int` (optional, default current), `provincias: list[str] | None` (optional, default `[]`).
  - Wraps: `consultar_cuit()` to get padron → `padron.to_output()` → `engine.calcular(output, mes, anio, provincias)`.
  - TA cache from lifespan context.
  - Uniform error handling: `INVALID_CUIT`, `ARCA_ERROR`.
  - Returns `RulesOutput` in `UnifiedResponse` envelope.
  - Scope (HTTP): `calendar:read`.
- [x] **2.4 Create `fiscal_agent/mcp/tools/taxpayer.py`** — `get_taxpayer` tool:
  - Parameters: `cuit: str` (required).
  - Wraps: `consultar_cuit()` → `PadronA5Output`.
  - TA cache from lifespan context.
  - Error handling: `CUIT_NOT_FOUND`, `CONSTANCIA_ERROR`.
  - Returns `PadronA5Output` in `UnifiedResponse` envelope.
  - Scope (HTTP): `taxpayer:read`.

---

## Phase 3: Browser Tools — Deuda + Facilidades + Registro

These tools require `ComposioBrowser` (initialized in lifespan). If browser is `None`, they return `BROWSER_NOT_CONFIGURED` error.

- [x] **3.1 Create `fiscal_agent/mcp/tools/deuda.py`** — `extract_deuda` tool:
  - Parameters: `cuit: str` (required).
  - Wraps: `browser.run_single([FullTask(cuit=...)])`.
  - Guard: if `browser` is `None`, return `ApiError(code="BROWSER_NOT_CONFIGURED", ...)`.
  - Error handling: `BROWSER_TIMEOUT` (from timeout exceptions), `BROWSER_ERROR` (navigation/parsing errors).
  - Returns `DeudaOutput` in `UnifiedResponse` envelope.
  - Scope (HTTP): `taxpayer:read`.
- [x] **3.2 Create `fiscal_agent/mcp/tools/facilidades.py`** — `extract_facilidades` tool:
  - Parameters: `cuit: str` (required).
  - Wraps: `browser.run_single([FacilidadesTask(cuit=...)])`.
  - Same guard and error handling pattern as `deuda.py`.
  - Returns `DeudaOutput.facilidades` (the payment plans list) in `UnifiedResponse` envelope.
  - Scope (HTTP): `taxpayer:read`.
- [x] **3.3 Create `fiscal_agent/mcp/tools/registro.py`** — `extract_registro` tool:
  - Parameters: `cuit: str` (required).
  - Wraps: `browser.run_single([RegistroTask(cuit=...)])`.
  - Same guard and error handling pattern as `deuda.py`.
  - Returns `RegistroOutput` in `UnifiedResponse` envelope.
  - Scope (HTTP): `taxpayer:read`.

---

## Phase 4: Complex Tools — Pipeline + Report + Rentas

These tools orchestrate multiple subsystems. `run_pipeline` is the most complex — it wraps the full pipeline function from `cli.py`.

- [x] **4.1 Create `fiscal_agent/mcp/tools/pipeline.py`** — `run_pipeline` tool:
  - Parameters: `cuit: str` (required), `mes: int` (optional), `anio: int` (optional), `with_deuda: bool` (default `False`), `with_facilidades: bool` (default `False`), `with_registro: bool` (default `False`), `send_email: bool` (default `False`).
  - Wraps: `_procesar_cliente_pipeline()` from `cli.py`.
  - Constructs `ClientConfig(cuit=cuit)`, passes engine, pdf_gen, browser (from lifespan context), token/sign from TA cache.
  - Catches pipeline errors gracefully — reports them in `UnifiedResponse` result (not as top-level error).
  - Returns pipeline result dict in `UnifiedResponse` envelope.
  - Scope (HTTP): `report:write`.
- [x] **4.2 Create `fiscal_agent/mcp/tools/report.py`** — `get_report_pdf` tool:
  - Parameters: `cuit: str` (required), `mes: int` (optional), `anio: int` (optional), `con_deuda: bool` (default `False`).
  - Runs a partial pipeline (calendar + optionally deuda via browser if `con_deuda=True`), then calls `pdf_gen.generar()`.
  - Returns `{"pdf_path": "storage/calendarios/Calendario_{CUIT}_{YYYY-MM}.pdf", "pages": N}` in `UnifiedResponse` envelope.
  - Error handling: `BROWSER_NOT_CONFIGURED` if `con_deuda=True` but browser is `None`.
  - Scope (HTTP): `report:read`.
- [x] **4.3 Create `fiscal_agent/mcp/tools/rentas.py`** — `match_rentas_cordoba` tool:
  - Parameters: `cuit: str` (required), `provincias: list[str] | None` (optional, default `[]`).
  - Wraps: `consultar_cuit()` → `evaluar_rentas_cordoba(provincias, impuestos_ws=padron.regimenGeneral.impuestos, registro_impuestos=None)`.
  - TA cache from lifespan context.
  - Error handling: `INVALID_CUIT`.
  - Returns `RentasCordobaMatching` in `UnifiedResponse` envelope.
  - Scope (HTTP): `calendar:read`.

---

## Phase 5: Entry Point + Dependencies

Wire the MCP server into the application entry point and add the `mcp` dependency.

- [x] **5.1 Modify `fiscal_agent/__main__.py`** — Add `mcp` subcommand dispatch:
  - If `sys.argv[1] == "mcp"`, call `fiscal_agent.mcp.transport.run_mcp()`.
  - Keep existing `cli.main()` as default for backward compatibility (when no args or other subcommands).
  - Usage: `python -m fiscal_agent mcp` → STDIO mode.
  - Usage: `MCP_TRANSPORT=http python -m fiscal_agent mcp` → HTTP/SSE mode.
- [x] **5.2 Modify `pyproject.toml`** — Add `mcp>=1.27,<2` to `[project] dependencies`.

---

## Suggested Work Units (Commit Plan)

| Unit | Phase | Files | Lines (est.) | Description |
|------|-------|-------|-------------|-------------|
| 1 | Phase 1 | `mcp/__init__.py`, `mcp/server.py`, `mcp/transport.py` | ~165 | Package + FastMCP server skeleton + transport dispatcher + HTTP auth middleware |
| 2 | Phase 2 | `mcp/tools/__init__.py`, `mcp/tools/health.py`, `mcp/tools/calendar.py`, `mcp/tools/taxpayer.py` | ~115 | Simple tools without browser dependency |
| 3 | Phase 3 | `mcp/tools/deuda.py`, `mcp/tools/facilidades.py`, `mcp/tools/registro.py` | ~120 | Browser-dependent extraction tools |
| 4 | Phase 4 | `mcp/tools/pipeline.py`, `mcp/tools/report.py`, `mcp/tools/rentas.py` | ~155 | Complex orchestration tools |
| 5 | Phase 5 | `__main__.py`, `pyproject.toml` | ~16 | Wire entry point and dependency |

**Total estimated lines**: ~571 (new) + ~16 (modified) = ~571 net change

### Delivery Strategy

Single PR (C2). The 5 work units above can be submitted as separate commits within the same PR for reviewer clarity, but the PR itself is a single atomic delivery. Commit order: Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 5. Each commit is independently reviewable and represents a coherent unit of functionality.

---

## Dependency Graph (must-merge order)

```
Phase 1 (server.py + transport.py)  ←─── all tools depend on lifespan context
         │
    ┌────┴────┬───────────┬──────────────┐
    │         │           │              │
 Phase 2   Phase 3     Phase 4       Phase 5
 (simple)  (browser)  (complex)   (entry + deps)
                                     ↑
                    can merge anytime (no tool dependency)
```

Phase 5 has no compile-time dependency on the tool files, but functionally the server won't start until at least one tool is registered. It can be committed last or first — order doesn't matter as long as it's in the PR.
