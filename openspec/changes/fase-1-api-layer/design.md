# Design: Fase 1 — API Layer

## Technical Approach

Servidor FastAPI que expone el pipeline fiscal CLI como REST endpoints. Toda la lógica de negocio se **reusa** desde `cli.py` (`_procesar_cliente_pipeline`), `rules_engine.py`, `arca_ws.py`, y `browser.py`. No hay duplicación — los route handlers son thin adapters que llaman al código existente y envuelven el resultado en `UnifiedResponse[T]`.

## Architecture Decisions

| Decisión | Opciones | Selección | Razón |
|----------|----------|-----------|-------|
| Framework | FastAPI, Flask, Starlette directo | FastAPI | Validación Pydantic nativa, docs automáticas, lifespan async, tipado fuerte |
| Startup | `lifespan`, `@app.on_event`, lazy init | `lifespan` | Deprecado `on_event` en FastAPI 0.115+. Lifespan es el contrato moderno |
| TA caching | pickle file, Redis, en memoria | pickle file | Ya implementado en `obtener_ta()`. Reusamos `cache_file=` igual que el CLI |
| Browser async | `asyncio.run()`, `run_in_executor()`, async nativo | `asyncio.run()` | `ComposioBrowser.run_single()` ya maneja su propio event loop. `asyncio.run()` dentro de `run_in_executor` es suficiente |
| Output envelope | `UnifiedResponse` directo, `response_model=` | `response_model=UnifiedResponse[T]` | FastAPI valida la respuesta en runtime. El helper `_response()` cubre casos dinámicos |
| DI pattern | FastAPI Depends, constructor manual, global state | FastAPI Depends + startup singletons | `deps.py` expone `get_engine()`, `get_pdf_gen()`, `get_browser()` inicializados en lifespan |

## Data Flow

```
POST/GET Request → FastAPI Router → Route Handler
                                        │
                           ┌────────────┼────────────┐
                           ▼            ▼            ▼
                     deps.py    arca_ws.py    cli.py (pipeline)
                     (engine,   (obtener_TA,  (_procesar_cliente_
                      pdf_gen,   consultar_    pipeline, reusado
                      browser)   cuit)         sin cambios)
                           │            │            │
                           └────────────┼────────────┘
                                        ▼
                              UnifiedResponse[T]
                                        │
                                        ▼
                                  HTTP 200 JSON
```

### Por endpoint:

**POST /v1/calendar**: `calendar.py` → `deps.get_engine()` → `consultar_cuit()` → `engine.calcular()` → `UnifiedResponse[RulesOutput]`

**POST /v1/report**: `report.py` → `_procesar_cliente_pipeline(engine, pdf_gen, browser, …)` → `UnifiedResponse[dict]`

**GET /v1/taxpayer/{cuit}**: `report.py` → `consultar_cuit()` → `UnifiedResponse[PadronA5Output]`

**POST /v1/extract**: `extract.py` → `ComposioBrowser.run_single()` → `UnifiedResponse[DeudaOutput]`

**GET /v1/health**: `health.py` → verifica TA cache + timestamp → `UnifiedResponse[dict]`

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `fiscal_agent/api/__init__.py` | Create | Package marker, exports `app` |
| `fiscal_agent/api/server.py` | Create | FastAPI app con lifespan (certs → TA → engine → pdf_gen), CORS, include routers |
| `fiscal_agent/api/deps.py` | Create | Singletons: `get_engine()`, `get_pdf_gen()`, `get_browser()`. Init en lifespan, lazy si hace falta |
| `fiscal_agent/api/routes/__init__.py` | Create | Package marker |
| `fiscal_agent/api/routes/calendar.py` | Create | `POST /v1/calendar` — reusa `consultar_cuit()` + `engine.calcular()` |
| `fiscal_agent/api/routes/report.py` | Create | `POST /v1/report`, `GET /v1/taxpayer/{cuit}` — reusa `_procesar_cliente_pipeline()` |
| `fiscal_agent/api/routes/extract.py` | Create | `POST /v1/extract` — reusa `ComposioBrowser.run_single()` |
| `fiscal_agent/api/routes/health.py` | Create | `GET /v1/health` — status + TA vigente |

## Interfaces / Contracts

```python
# Request bodies reusan IdempotentRequest de models.py
class CalendarRequest(IdempotentRequest):
    cuit: str
    mes: int = Field(ge=1, le=12)
    anio: int = Field(ge=2020)

class ReportRequest(IdempotentRequest):
    cuit: str; mes: int; anio: int
    with_deuda: bool = False
    with_facilidades: bool = False
    with_registro: bool = False
    send_email: bool = True

class ExtractRequest(IdempotentRequest):
    cuit: str
    tasks: list[Literal["deuda", "facilidades", "registro"]]
```

```python
# Helper para respuestas uniformes
def _response(
    data: T, status="success",
    next_actions=None, human_approval=False, error=None
) -> UnifiedResponse[T]: ...
```

## Testing Strategy

| Layer | What | Approach |
|-------|------|----------|
| Unit | Route handlers con mock de deps | `httpx.AsyncClient` + `TestClient` |
| Integration | Pipeline real con output | FastAPI `TestClient` contra endpoints |

## Open Questions

- [ ] None — el diseño está acoplado a infra existente. Las decisiones están tomadas en proposal y specs.

## Rollout

El server corre con `uvicorn fiscal_agent.api.server:app`. El CLI sigue funcionando sin cambios. No se requiere migración.
