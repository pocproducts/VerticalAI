# Tasks: engram-memory-and-dockerization

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~500-550 |
| 400-line budget risk | Medium-High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1: memory-engram → PR 2: docker-infrastructure |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: Medium-High

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | memory/ package + cli hooks + tests (~425 lines) | PR 1 | Base: main. Capa aislada, sin tocar store/auth/rate_limiter |
| 2 | Dockerfile + compose + .env (~90 lines) | PR 2 | Base: main. Independiente de PR 1, solo archivos nuevos |

## Phase 1: Foundation — Memory Package

- [x] 1.1 Crear `fiscal_agent/memory/__init__.py` — exportar `FiscalMemoryClient`, `MemoryConfig`; sin imports de fiscal_agent
- [x] 1.2 Crear `fiscal_agent/memory/config.py` — `MemoryConfig(BaseSettings)` con `engram_url`, `redis_cache_url`, `redis_max_mb`, `engram_timeout`; env_prefix `MEMORY_`
- [x] 1.3 Crear `fiscal_agent/memory/client.py` — clase `FiscalMemoryClient` con init lazy de Redis, 4 métodos WRITE (`save_padron_result`, `save_extraction_result`, `save_pdf_sent`, `save_pipeline_error`) que hacen `_engram_post()` con `agent_id=CUIT`
- [x] 1.4 Implementar 4 métodos READ en `client.py` — `get_padron_history`, `get_extraction_history`, `get_pipeline_history`, `get_last_error` con `_engram_get()` y cache intermedio
- [x] 1.5 Implementar Redis cache layer en `client.py` — `_cache_get/set`, `_redis_has_space()` (25MB), TTLs: 24h padron, 7d extraction, 1h pipeline; solo cachea READs
- [x] 1.6 Implementar helpers `is_available()` (GET /health) y best-effort try/except silencioso en toda operación pública

## Phase 2: Pipeline Integration

- [x] 2.1 Modificar `cli.py:_procesar_cliente_pipeline()` — agregar parámetro opcional `memory_client: Optional[FiscalMemoryClient] = None` después de `config`
- [x] 2.2 Insertar hooks en pipeline: ① antes de WS ARCA: `get_padron_history` + log, ② tras WS exitoso: `save_padron_result`, ③ tras cada browser extraction: `save_extraction_result`, ④ tras PDF+email: `save_pdf_sent`, ⑤ en except: `save_pipeline_error`
- [x] 2.3 Modificar `cli.py:run()` — instanciar `FiscalMemoryClient` una vez, verificar `is_available()`, pasar a `_procesar_cliente_pipeline()` como `memory_client`

## Phase 3: Docker Infrastructure

- [x] 3.1 Crear `Dockerfile` — `python:3.11-slim`, pip install uv, `uv sync --no-dev --frozen`, COPY código, `PYTHONPATH=/app`, CMD python -m fiscal_agent
- [x] 3.2 Crear `docker-compose.yml` — 3 servicios (fiscal-agent, engram, redis) con volúmenes (engram-data, redis-data, pdf-output), healthchecks, restart:always para redis y engram
- [x] 3.3 Agregar `MEMORY_ENGRAM_URL`, `MEMORY_REDIS_CACHE_URL`, `MEMORY_REDIS_MAX_MB`, `MEMORY_ENGRAM_TIMEOUT` a `.env` con defaults Docker

## Phase 4: Testing

- [x] 4.1 Test `MemoryConfig` — defaults y override con monkeypatch de env vars
- [x] 4.2 Test WRITE — mock `requests.post`, verificar payload y agent_id=CUIT en cada método
- [x] 4.3 Test READ — mock `requests.get` con data de Engram, verificar parse y estructura de retorno
- [x] 4.4 Test cache TTLs — `fakeredis`, verificar que reads cachean y writes no, verificar expiración
- [x] 4.5 Test best-effort — mock `requests.post` para lanzar `ConnectionError`, verificar que retorna None sin propagar
- [x] 4.6 Test `_redis_has_space` — `fakeredis` con `INFO memory` mock, verificar límite 25MB
