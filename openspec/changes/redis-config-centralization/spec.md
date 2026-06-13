# Spec: Redis Config Centralization

## 1. Centralized Config Module

### REQ-CONFIG-1: `fiscal_agent/config.py` exists as the single source of truth for env vars
- **Scenario 1.1**: Importing `from fiscal_agent.config import AppSettings` MUST resolve
- **Scenario 1.2**: `AppSettings()` MUST read from environment variables with the SAME names as today
- **Scenario 1.3**: `AppSettings()` MUST fall back to documented defaults when env vars are unset
- **Scenario 1.4**: `AppSettings` MUST be a frozen/dataclass-like Pydantic model (no accidental mutation)

### REQ-CONFIG-2: `RedisConfig` sub-model consolidates both Redis URLs
- **Scenario 2.1**: `RedisConfig.url` MUST default to `redis://localhost:6379/0`
- **Scenario 2.2**: `RedisConfig.url` MUST be configurable via `REDIS_URL` env var
- **Scenario 2.3**: `RedisConfig.cache_url` MUST default to `redis://localhost:6379/0`
- **Scenario 2.4**: `RedisConfig.cache_url` MUST be configurable via `MEMORY_REDIS_CACHE_URL` env var
- **Scenario 2.5**: `RedisConfig.max_mb` MUST default to `25`
- **Scenario 2.6**: `RedisConfig.max_mb` MUST be configurable via `MEMORY_REDIS_MAX_MB` env var

### REQ-CONFIG-3: Credentials sub-model
- **Scenario 3.1**: `Credentials.cuit` MUST default to `20324837796`
- **Scenario 3.2**: `Credentials.cuit` MUST be configurable via `ESTUDIO_CUIT` env var
- **Scenario 3.3**: `Credentials.clave_fiscal` MUST default to empty string
- **Scenario 3.4**: `Credentials.clave_fiscal` MUST be configurable via `ESTUDIO_CLAVE_FISCAL` env var
- **Scenario 3.5**: `Credentials.composio_api_key` MUST default to empty string
- **Scenario 3.6**: `Credentials.composio_api_key` MUST be configurable via `COMPOSIO_API_KEY` env var

## 2. Server Integration

### REQ-SERVER-1: `api/server.py` uses `RedisConfig` for Redis connection
- **Scenario 4.1**: `server.py` MUST import `RedisConfig` from `fiscal_agent.config`
- **Scenario 4.2**: The lifespan MUST call `redis.from_url(settings.redis.url)` instead of `os.getenv('REDIS_URL')`

### REQ-SERVER-2: `api/server.py` keeps `decode_responses=True` for the async client
- **Scenario 5.1**: The `redis.from_url()` call MUST still pass `decode_responses=True`

## 3. Memory Integration

### REQ-MEMORY-1: `memory/config.py` uses `RedisConfig` for cache URL
- **Scenario 6.1**: If `MEMORY_REDIS_CACHE_URL` is set in env, `MemoryConfig` MUST use it
- **Scenario 6.2**: If `MEMORY_REDIS_CACHE_URL` is NOT set but `AppSettings.redis.cache_url` exists, MUST fall back to that
- **Scenario 6.3**: The `MemoryConfig` model MUST remain backward-compatible (no new required fields)

## 4. CLI Integration

### REQ-CLI-1: `cli.py` uses `AppSettings` for credential validation
- **Scenario 7.1**: CLI MUST get `COMPOSIO_API_KEY` from `settings.credentials.composio_api_key` instead of `os.environ.get('COMPOSIO_API_KEY')`
- **Scenario 7.2**: CLI MUST get `ESTUDIO_CLAVE_FISCAL` from `settings.credentials.clave_fiscal` instead of `os.environ.get('ESTUDIO_CLAVE_FISCAL')`
- **Scenario 7.3**: CLI MUST get `ESTUDIO_CUIT` from `settings.credentials.cuit` instead of `os.environ.get('ESTUDIO_CUIT')`
