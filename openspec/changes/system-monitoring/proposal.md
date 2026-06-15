# Proposal: System Monitoring

## Intent

El frontend dashboard (Next.js) necesita datos reales de infraestructura. Hoy solo existe `GET /v1/health` básico. Sin este cambio no hay visibilidad del estado del sistema, errores de pipeline, ni métricas de performance — el dashboard no tendría datos que mostrar.

## Scope

### In Scope
- Health check extendido (API, Redis, Engram, TA ARCA, Composio)
- System metrics (pipeline runs, tasa éxito/error, períodos 24h/7d/30d)
- Services status (cada servicio con estado, uptime, última verificación)
- Activity feed (eventos recientes del sistema)
- Error list (errores con tipo, severidad, timestamp, servicio)
- Request metrics middleware (conteo, errores HTTP, latency)
- Pipeline run tracking como eventos first-class en Engram

### Out of Scope
- Deployments tracking, on-call schedules, postmortems
- SLA metrics, uptime histórico real
- Notificaciones

## Capabilities

### New
- `system-health`: Health check extendido con status de dependencias
- `system-metrics`: Métricas agregadas de pipeline runs y errores
- `system-services`: Estado en vivo de cada servicio del sistema
- `system-activity`: Feed de actividad reciente del sistema
- `system-errors`: Lista de errores con severidad y servicio afectado
- `request-metrics`: Middleware FastAPI que captura conteo, errores HTTP y latency
- `pipeline-run-tracking`: PipelineRun como modelo first-class persistido en Engram

### Modified
- `rest-api`: GET /v1/health extiende respuesta para incluir status de Redis, Engram, TA ARCA, Composio

## Approach

1. Routers FastAPI en `fiscal_agent/api/system/` (health, metrics, services, activity, errors)
2. Middleware de request metrics en `fiscal_agent/api/middleware/metrics.py`
3. PipelineRun model en `fiscal_agent/models.py` — evento first-class con run_id, status, timestamps
4. Pipeline existente emite eventos pipeline_run a Engram (tipo: `pipeline_run`)
5. Reusar `FiscalMemoryClient` para consultar datos de Engram
6. Redis cache para métricas agregadas (TTL 30s)

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `fiscal_agent/api/system/` | New | 5 routers de monitoreo |
| `fiscal_agent/api/middleware/metrics.py` | New | Request metrics middleware |
| `fiscal_agent/models.py` | Modified | Nuevo modelo PipelineRun |
| `fiscal_agent/api/server.py` | Modified | Registrar routers + middleware |
| `fiscal_agent/pipeline.py` | Modified | Emitir eventos pipeline_run |
| `openspec/specs/rest-api/spec.md` | Modified | Delta: health endpoint extendido |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Engram queries lentos con muchas observaciones | Medium | Cache en Redis con TTL 30s; paginación |
| PipelineRun duplicados en ejecución concurrente | Low | Idempotency key por run_id (UUID v4) |
| Métricas en memoria se pierden al reiniciar | Low | Persistir en Redis; aceptable para Fase 1 |

## Rollback Plan

1. Remover `fiscal_agent/api/system/` y `fiscal_agent/api/middleware/metrics.py`
2. Revertir `models.py`, `pipeline.py`, `api/server.py`
3. Verificar que GET /v1/health vuelve a comportamiento original
4. Si hay datos pipeline_run en Engram, se convierten en observaciones huérfanas (no hay rollback de datos)

## Dependencies

- `FiscalMemoryClient` (existente) para consultar Engram
- Redis (existente) para cache de métricas
- Pipeline existente para emitir eventos pipeline_run

## Success Criteria

- [ ] GET /v1/health retorna status de API, Redis, Engram, TA ARCA, Composio
- [ ] GET /v1/system/metrics retorna pipeline runs por 24h/7d/30d
- [ ] GET /v1/system/services retorna servicios con estado y uptime
- [ ] GET /v1/system/activity retorna eventos recientes ordenados por timestamp
- [ ] GET /v1/system/errors retorna errores con tipo, severidad, servicio
- [ ] Cada request HTTP genera métricas de conteo y latency
- [ ] Cada pipeline run se persiste como PipelineRun en Engram
