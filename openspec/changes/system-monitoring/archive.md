# Archive: system-monitoring

**Archived**: 2026-06-13
**Status**: ✅ Complete — all 13/13 tasks implemented, all 5 CRITICALs verified and corrected

## Intent

Módulo backend de monitoreo de infraestructura: health checks, system metrics, services status, activity feed, error list, request metrics middleware, y pipeline run tracking. Sin este cambio el frontend dashboard no tendría datos de infraestructura que mostrar.

## Capabilities Implementadas

| Capacidad | Dominio Spec | Descripción |
|-----------|-------------|-------------|
| `system-health` | `openspec/specs/system-health/spec.md` | Health check extendido con status de Redis, Engram, TA ARCA, Composio |
| `system-metrics` | `openspec/specs/system-metrics/spec.md` | Métricas agregadas de pipeline runs (24h/7d/30d) |
| `system-services` | `openspec/specs/system-services/spec.md` | Estado en vivo de cada servicio con uptime y latencia |
| `system-activity` | `openspec/specs/system-activity/spec.md` | Feed de actividad reciente del sistema |
| `system-errors` | `openspec/specs/system-errors/spec.md` | Lista de errores con tipo, severidad, servicio |
| `request-metrics` | `openspec/specs/request-metrics/spec.md` | Middleware FastAPI in-memory (conteo, status codes, latency P50/P95/P99) |
| `pipeline-run-tracking` | `openspec/specs/pipeline-run-tracking/spec.md` | PipelineRun como modelo first-class persistido en Engram |
| `rest-api` (modified) | `openspec/specs/rest-api/spec.md` | GET /v1/health extendido con services[] |

## Specs Synced

| Domain | Action | Details |
|--------|--------|---------|
| `rest-api` | Modified | Requirement 5 (GET /v1/health) reemplazado con health extendido: 5 scenarios (extended health, Redis failure, TA expired, Composio invalid, backward compat) |

## Files Created

| File | Description |
|------|-------------|
| `fiscal_agent/api/routes/monitor.py` | Router con GET /v1/system/{metrics,services,activity,errors} |
| `fiscal_agent/api/middleware/__init__.py` | Package init para middleware |
| `fiscal_agent/api/middleware/metrics.py` | RequestMetricsStore in-memory + RequestMetricsMiddleware |
| `fiscal_agent/tests/test_health_extended.py` | Tests para health endpoint extendido |
| `fiscal_agent/tests/test_system_routes.py` | Tests para system routes |
| `fiscal_agent/tests/test_metrics_middleware.py` | Tests para metrics middleware |

## Files Modified

| File | Changes |
|------|---------|
| `fiscal_agent/api/routes/health.py` | Mutado a async; checks Redis, Engram, TA, Composio |
| `fiscal_agent/api/server.py` | Registro de monitor router + metrics middleware |
| `fiscal_agent/models.py` | Nuevos modelos: `PipelineRun`, `SystemHealth`, `ServiceStatus`, `SystemMetrics`, `ActivityEvent`, `ErrorEvent` |
| `fiscal_agent/memory/client.py` | Agregado `save_pipeline_run()` |
| `fiscal_agent/cli.py` | Emisión de PipelineRun al final del pipeline |
| `fiscal_agent/mcp/tools/pipeline.py` | Emisión de PipelineRun al final del pipeline MCP |

## Verify CRITICALs Corregidos

| ID | Issue | Fix |
|----|-------|-----|
| C1 | `ServiceStatus.status` permitía valores incorrectos | Forzado a `healthy\|degraded\|down` |
| C2 | `ErrorEvent.trend` faltante | Campo `trend` agregado al modelo Pydantic |
| C3 | `SystemMetrics` fields inconsistentes | Renombrados a `total_pipeline_runs`, `total_cuits_processed` |
| C4 | `ServiceStatus.uptime` faltante | Campo `uptime` agregado con formato ISO 8601 |
| C5 | Activity feed sin orden consistente | Query modificada para ORDER BY timestamp DESC |

## Tasks Progress

| Phase | Tasks | Status |
|-------|-------|--------|
| Phase 1: Models | T-1 | ✅ |
| Phase 2: Health extendido | T-2 | ✅ |
| Phase 3: System routes | T-3, T-4, T-5, T-6, T-7 | ✅ |
| Phase 4: Request metrics middleware | T-8, T-9 | ✅ |
| Phase 5: Pipeline run tracking | T-10a, T-10b, T-10c | ✅ |
| Phase 6: Tests | T-11, T-12, T-13 | ✅ |

**Total**: 13/13 tasks complete (100%)

## Architecture Decisions Preserved

| AD | Decision |
|----|----------|
| AD1 | Router único `monitor.py` (patrón flat) vs subdirectorio `system/` |
| AD2 | Request metrics in-memory (latencia cero, se pierde al reiniciar — aceptable) |
| AD3 | PipelineRun en sesión `cuit-{cuit}` con type `pipeline_run` |
| AD4 | Cache TTLs: metrics 30s, services 15s, activity 10s, errors 30s |

## Source of Truth Updated

- `openspec/specs/rest-api/spec.md` — Requirement 5 con health extendido y 5 escenarios

## SDD Cycle Complete

✅ Propose → ✅ Spec → ✅ Design → ✅ Apply → ✅ Verify → ✅ Archive
