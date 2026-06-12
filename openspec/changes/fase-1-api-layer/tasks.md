# Tasks: Fase 1 — API Layer

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~250-350 |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | single PR |
| Delivery strategy | single-pr |
| Chain strategy | size-exception |

Decision needed before apply: Yes
Chained PRs recommended: No
Chain strategy: size-exception
400-line budget risk: Low

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Package structure + deps + server | PR 1 | Base del servidor |
| 2 | Routes: health + calendar | PR 1 | Endpoints más simples |
| 3 | Routes: taxpayer + extract + report | PR 1 | Endpoints que reusan pipeline CLI |
| 4 | Wire exports | PR 1 | `__init__.py` updates |

## Phase 1: Package Structure

- [x] 1.1 Crear `fiscal_agent/api/__init__.py` como package marker
- [x] 1.2 Crear `fiscal_agent/api/routes/__init__.py` como package marker
- [x] 1.3 Crear `fiscal_agent/api/deps.py` — singletons: `get_engine()`, `get_pdf_gen()`, `get_browser()`. Lifespan las inicializa reusando `obtener_ta()` con pickle cache.

## Phase 2: Server + Health

- [x] 2.1 Crear `fiscal_agent/api/server.py` — FastAPI app con routers y version
- [x] 2.2 Crear `fiscal_agent/api/routes/health.py` — `GET /v1/health` → `UnifiedResponse[dict]` con status, timestamp, TA vigente

## Phase 3: Calendar + Taxpayer (reusan lógica CLI)

- [x] 3.1 Crear `fiscal_agent/api/routes/calendar.py` — `POST /v1/calendar`: recibe `CalendarRequest`, llama `consultar_cuit()` + `engine.calcular()`, envuelve en `UnifiedResponse[RulesOutput]`
- [x] 3.2 Agregar en `fiscal_agent/api/routes/report.py`: `GET /v1/taxpayer/{cuit}` → `consultar_cuit()` → `UnifiedResponse[PadronA5Output]`

## Phase 4: Extract + Report (browser + pipeline completo)

- [x] 4.1 Crear en `fiscal_agent/api/routes/extract.py`: `POST /v1/extract` recibe `ExtractRequest`, llama `ComposioBrowser.run_single()`, envuelve en `UnifiedResponse[DeudaOutput]`
- [x] 4.2 Agregar en `fiscal_agent/api/routes/report.py`: `POST /v1/report` recibe `ReportRequest`, ejecuta `_procesar_cliente_pipeline()` con flags, envuelve en `UnifiedResponse[dict]`

## Phase 5: Exports + Dependencies

- [ ] 5.1 ~~Agregar `fastapi` y `uvicorn` en `pyproject.toml`~~ (pendiente — instalar dependencias)
- [x] 5.2 Exportar nuevos módulos desde `fiscal_agent/__init__.py` si aplica
