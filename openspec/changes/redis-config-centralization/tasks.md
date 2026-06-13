# Tasks: Redis Config Centralization

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~120-150 |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Delivery strategy | single-pr |

## Phase 1: Core Config Module

- [ ] **1.1** — Crear `fiscal_agent/config.py` con `RedisConfig`, `Credentials`, `AppSettings` y `get_settings()`.
- [ ] **1.2** — Agregar `from_config()` classmethod a `MemoryConfig` en `memory/config.py`.

## Phase 2: Server Integration

- [ ] **2.1** — Actualizar `api/server.py`: importar `get_settings`, reemplazar `os.getenv('REDIS_URL')` con `settings.redis.url`.

## Phase 3: CLI Integration

- [ ] **3.1** — Actualizar `cli.py`: importar `get_settings`, reemplazar `os.environ.get('COMPOSIO_API_KEY')`, `os.environ.get('ESTUDIO_CLAVE_FISCAL')`, `os.environ.get('ESTUDIO_CUIT')` con `settings.credentials.*`.

## Phase 4: MCP Server Integration

- [ ] **4.1** — Actualizar `mcp/server.py`: importar `get_settings`, reemplazar `os.environ.get('COMPOSIO_API_KEY')`, `os.environ.get('ESTUDIO_CUIT')`, `os.environ.get('ESTUDIO_CLAVE_FISCAL')`.

## Phase 5: API Route Integration

- [ ] **5.1** — Actualizar `api/deps.py`: importar `get_settings`, reemplazar `os.environ.get('ESTUDIO_CUIT')`.
- [ ] **5.2** — Actualizar `api/routes/extract.py` y `api/routes/report.py`: recibir credentials desde settings.
- [ ] **5.3** — Actualizar `mcp/tools/deuda.py`, `mcp/tools/facilidades.py`, `mcp/tools/registro.py`, `mcp/tools/report.py`: usar credentials desde settings.
