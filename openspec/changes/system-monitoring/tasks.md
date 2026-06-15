# Tasks: System Monitoring

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~420-480 |
| 400-line budget risk | Medium |
| Chained PRs recommended | No |
| Suggested split | Single PR |
| Delivery strategy | single-pr |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: size-exception
400-line budget risk: Medium

## Phase 1: Models

- [x] T-1: Agregar en `fiscal_agent/models.py` los modelos `SystemHealth`, `ServiceStatus`, `SystemMetrics`, `ActivityEvent`, `ErrorEvent`, `PipelineRun` con Pydantic v2 (ConfigDict extra='forbid', Field con description)

## Phase 2: Health check extendido

- [x] T-2: Modificar `fiscal_agent/api/routes/health.py` — mutar a async, chequear Redis (ping via `app.state.redis`), Engram (GET /health via httpx), TA ARCA (token vigente), Composio (API key ping vía settings), retornar `SystemHealth` con `services[]`

## Phase 3: System routes

- [x] T-3: Crear `fiscal_agent/api/routes/monitor.py` con GET /v1/system/metrics (`period: Literal['24h','7d','30d']`) — agregar desde Engram observaciones type `pipeline_run`, retornar `SystemMetrics`
- [x] T-4: En `monitor.py`, GET /v1/system/services — checkear cada servicio (API, Redis, Engram, TA, Composio) con latencia, retornar `list[ServiceStatus]`
- [x] T-5: En `monitor.py`, GET /v1/system/activity (`limit`, `offset`) — buscar observaciones Engram type `pipeline_run|error`, retornar `list[ActivityEvent]`
- [x] T-6: En `monitor.py`, GET /v1/system/errors (`severity`, `service`, `period`) — filtrar observaciones type `error` desde Engram, retornar `list[ErrorEvent]`
- [x] T-7: En `fiscal_agent/api/server.py` — importar `monitor.router` y registrar `app.include_router(monitor.router, tags=['system'], prefix='')`

## Phase 4: Request metrics middleware

- [x] T-8: Crear `fiscal_agent/api/middleware/__init__.py` (package) y `fiscal_agent/api/middleware/metrics.py` con `EndpointMetrics` dataclass, `RequestMetricsStore` (thread-safe via Lock), y `RequestMetricsMiddleware` (cuenta requests por route template, status range 2xx/4xx/5xx, latencias para P50/P95/P99)
- [x] T-9: En `fiscal_agent/api/server.py` — agregar `app.add_middleware(RequestMetricsMiddleware)` antes del rate limiter

## Phase 5: Pipeline run tracking

- [x] T-10a: En `fiscal_agent/memory/client.py` — agregar `save_pipeline_run(cuit, run: PipelineRun)` que escribe observación type `pipeline_run` en sesión `cuit-{cuit}`
- [x] T-10b: En `fiscal_agent/cli.py` — al final de `_procesar_cliente_pipeline()` (antes del return), invocar `memory_client.save_pipeline_run()` con `PipelineRun` construido desde `resultado` y el tiempo de ejecución
- [x] T-10c: En `fiscal_agent/mcp/tools/pipeline.py` — mismo pattern: pasar `memory_client` para que `_procesar_cliente_pipeline` guarde el `PipelineRun`

## Phase 6: Tests

- [x] T-11: Crear `fiscal_agent/tests/test_health_extended.py` — `TestClient` con health router, mock Redis y Engram, verificar escenarios: all healthy, Redis caído, TA expirado, Composio inválido (usando spec scenarios)
- [x] T-12: Crear `fiscal_agent/tests/test_system_routes.py` — `TestClient` con monitor router, mock `FiscalMemoryClient._search_observations()`, verificar: metrics 24h/7d/30d, services list, activity pagination, errors filter por severity/service
- [x] T-13: Crear `fiscal_agent/tests/test_metrics_middleware.py` — unit tests para `RequestMetricsStore` (record, snapshot, reset, P50/P95/P99) e integration test con `TestClient` verificando que cada request incrementa contadores
