# Design: System Monitoring

## Technical Approach

Siete capacidades implementadas sobre el stack existente (FastAPI, Engram, Redis) siguiendo los patrones del proyecto:

1. **Health extendido**: el router `health.py` actual muta a async y chequea cada dependencia secuencialmente, reportando `healthy`/`unhealthy` por servicio.
2. **System endpoints**: un nuevo router `monitor.py` en `api/routes/` agrupa `/v1/system/metrics|services|activity|errors`.
3. **Request metrics**: middleware FastAPI que acumula conteos, status codes y latencias en un `dict[str, EndpointMetrics]` en memoria.
4. **PipelineRun tracking**: `FiscalMemoryClient.save_pipeline_run()` escribe observaciones tipo `pipeline_run` en la sesión Engram `cuit-{cuit}` del contribuyente.

Todas las queries a Engram usan `FiscalMemoryClient._engram_get()` con best-effort semantics (igual que el resto del memory layer). Redis cache con TTLs cortos amortigua el costo de las agregaciones.

## Architecture Decisions

### AD1: Router organization — single `monitor.py` vs subdirectory `system/`

| Option | Tradeoff | Decision |
|--------|----------|----------|
| `api/system/` con 5 routers | Rompe el patrón flat existente; 5 archivos nuevos en subdirectorio nuevo | ❌ |
| `monitor.py` en `api/routes/` | Sigue el patrón flat de `health.py`, `calendar.py`, etc.; un solo archivo para los 4 endpoints `/v1/system/*` | ✅ |

**Rationale**: el proyecto usa un archivo por dominio en `api/routes/`. Crear un subdirectorio `system/` introduce un patrón nuevo innecesario. `monitor.py` mantiene consistencia. El health endpoint existente (`health.py`) se modifica in-place porque ya está en `api/routes/`.

### AD2: Request metrics — in-memory vs Redis

| Option | Tradeoff | Decision |
|--------|----------|----------|
| Redis (Sorted Set por endpoint) | Consistente entre workers; agrega latency a cada request HTTP; complejidad de limpieza | ❌ |
| En memoria (`dict[str, EndpointMetrics]`) | Se pierde al reiniciar (especificado como aceptable); latencia cero; implementación trivial | ✅ |

**Rationale**: la spec dice explícitamente "Metrics are in-memory and MAY reset on server restart" (Req 4). No hay workers múltiples hoy. P50/P95/P99 requieren almacenar latencias individuales — en Redis sería un Sorted Set por endpoint con EXPIRY, pero in-memory es más simple, no bloquea requests con I/O, y cumple la spec.

### AD3: PipelineRun en Engram — misma sesión `cuit-xxx` vs proyecto separado

| Option | Tradeoff | Decision |
|--------|----------|----------|
| Nuevo proyecto Engram `fiscal-agent-pipeline` | Aísla datos de pipeline; rompe el patrón per-CUIT; búsquedas globales más complejas | ❌ |
| Sesión `cuit-{cuit}` con type `pipeline_run` | Co-locado con resto del historial del CUIT; reusa `FiscalMemoryClient._search_observations()`; sin cambios de infraestructura | ✅ |

**Rationale**: `FiscalMemoryClient` ya crea sesiones `cuit-{cuit}` y escribe observaciones con types (`padron`, `deuda`, `error`, etc.). Agregar type `pipeline_run` es seguir el mismo patrón. Las queries de activity feed y metrics pueden buscar con `?type=pipeline_run` en esas sesiones.

### AD4: Cache TTLs

| Endpoint | TTL | Rationale |
|----------|-----|-----------|
| `/v1/system/metrics` | 30s | Agregación cara (busca todas las observaciones del período); stale 30s aceptable |
| `/v1/system/services` | 15s | Estado de servicios cambia lento; refresh rápido permite detectar caídas |
| `/v1/system/activity` | 10s | Feed necesita verse fresco; puede ser stale hasta 10s |
| `/v1/system/errors` | 30s | La lista de errores no cambia rápido |

## Data Flow

```
┌──────────┐   GET /v1/*    ┌──────────────────┐   ┌─────────────────┐
│ Dashboard │ ─────────────→ │  FastAPI app      │──→│ Router handler  │
│ (Next.js) │ ←───────────── │  (server.py)      │←──│ (monitor/health)│
└──────────┘  JSON response  └───────┬──────────┘   └────────┬────────┘
                                      │                       │
                           ┌──────────┼───────────┐           │
                           ▼          ▼           ▼           │
                    ┌──────────┐ ┌──────────┐ ┌──────┐       │
                    │ Engram   │ │ Redis    │ │ In-  │       │
                    │ search   │ │ cache    │ │ mem  │       │
                    │ (sync)   │ │ (sync)   │ │ mtrcs│       │
                    └──────────┘ └──────────┘ └──────┘       │
                                                               ▼
                                                      ┌──────────────┐
                                                      │ Request      │
                                                      │ Metrics      │
                                                      │ Middleware   │
                                                      │ (every req)  │
                                                      └──────────────┘
```

Pipeline flow (write path):

```
Pipeline fin (cli.py / mcp) ──→ FiscalMemoryClient.save_pipeline_run()
                                     │
                                     ▼
                              Engram POST /observations
                              session_id: cuit-{cuit}
                              type: pipeline_run
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `fiscal_agent/api/routes/monitor.py` | Create | Router con GET /v1/system/{metrics,services,activity,errors} |
| `fiscal_agent/api/routes/health.py` | Modify | Mutar a async; chequear Redis, Engram, TA, Composio |
| `fiscal_agent/api/middleware/__init__.py` | Create | Package init |
| `fiscal_agent/api/middleware/metrics.py` | Create | Middleware FastAPI + RequestMetricsStore in-memory |
| `fiscal_agent/api/server.py` | Modify | Registrar monitor router + metrics middleware |
| `fiscal_agent/models.py` | Modify | Agregar modelo `PipelineRun` |
| `fiscal_agent/memory/client.py` | Modify | Agregar `save_pipeline_run()` |
| `fiscal_agent/cli.py` | Modify | Emitir PipelineRun al final del pipeline |
| `fiscal_agent/mcp/tools/pipeline.py` | Modify | Emitir PipelineRun al final del pipeline MCP |

## Interfaces / Contracts

### PipelineRun model (en `models.py`)

```python
class PipelineRun(BaseModel):
    """First-class pipeline execution record persisted in Engram."""

    run_id: str = Field(description='UUID v4 — idempotency key')
    cuit: str
    status: Literal['success', 'partial', 'failed']
    stages_completed: list[str] = Field(default_factory=list)
    error: str | None = None
    timestamp: datetime
    duration_seconds: float
```

### RequestMetricsStore (en `middleware/metrics.py`)

```python
from dataclasses import dataclass, field

@dataclass
class EndpointMetrics:
    count: int = 0
    status_2xx: int = 0
    status_4xx: int = 0
    status_5xx: int = 0
    latencies: list[float] = field(default_factory=list)

class RequestMetricsStore:
    """In-memory store, resets on restart. Thread-safe via Lock."""
    def get_snapshot(self) -> dict[str, EndpointMetrics]: ...
    def record(self, method: str, path: str, status_code: int, latency: float): ...
```

### Health service check response shape

```python
class ServiceStatus(BaseModel):
    service: str
    status: Literal['healthy', 'unhealthy']
    last_check: datetime
    latency_ms: float
    error: str | None = None
```

### Client method

```python
# En FiscalMemoryClient
def save_pipeline_run(self, cuit: str, run: PipelineRun) -> None: ...
```

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | `RequestMetricsStore` — record, snapshot, reset | Pytest directo; verificar conteos y percentiles |
| Unit | `PipelineRun` model validation | Pydantic validation tests |
| Unit | Health check — service failures simulados | Mock Redis, Engram, TA, Composio |
| Integration | Endpoints via `TestClient` | FastAPI TestClient con middleware y routers registrados |
| Integration | Redis cache interaction | Mock `FiscalMemoryClient._redis_client` |

## Open Questions

- [ ] El health endpoint actual es sync (`def health()`). Para chequear Redis async necesito mutarlo a `async def`. ¿Afecta compatibilidad? No — FastAPI maneja ambos.
- [ ] Middleware de metrics: ¿path pattern con parámetros (e.g. `/v1/report/{cuit}`) se agrupa por pattern o se registra individual? Propuesta: agrupar por `route.path` (template) en lugar de `request.url.path`.
