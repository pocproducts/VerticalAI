# Design: Redis Config Centralization

## Technical Approach

Crear un módulo `fiscal_agent/config.py` que centralice TODA la lectura de variables de entorno usando Pydantic `BaseSettings` anidado. Cada sub-modelo agrupa un dominio, y `AppSettings` los agrega a todos.

## Module Structure

```
fiscal_agent/
  config.py          ← NUEVO: AppSettings con sub-modelos
  memory/
    config.py        ← MODIFICADO: usa RedisConfig subyacente
  api/
    server.py        ← MODIFICADO: usa AppSettings().redis
  cli.py             ← MODIFICADO: usa AppSettings().credentials
  mcp/
    server.py        ← MODIFICADO: usa AppSettings().credentials
    tools/*.py       ← MODIFICADO: reciben credentials vía parámetro
```

## Config Models

```python
class RedisConfig(BaseSettings):
    model_config = SettingsConfigDict(env_prefix='REDIS_', extra='ignore')
    url: str = 'redis://localhost:6379/0'

    # These use raw env names (different prefix)
    cache_url: str = Field(default='redis://localhost:6379/0', alias='MEMORY_REDIS_CACHE_URL')
    max_mb: int = Field(default=25, alias='MEMORY_REDIS_MAX_MB')


class Credentials(BaseSettings):
    model_config = SettingsConfigDict(extra='ignore')
    cuit: str = Field(default='20324837796', alias='ESTUDIO_CUIT')
    clave_fiscal: str = Field(default='', alias='ESTUDIO_CLAVE_FISCAL')
    composio_api_key: str = Field(default='', alias='COMPOSIO_API_KEY')


class AppSettings(BaseSettings):
    model_config = SettingsConfigDict(env_file='.env', extra='ignore')
    redis: RedisConfig = RedisConfig()
    credentials: Credentials = Credentials()
```

### Architecture Decision: Why nested models + Field aliases instead of env_prefix everywhere?

- `REDIS_URL` has prefix `REDIS_` → natural for `env_prefix`
- `MEMORY_REDIS_CACHE_URL` has prefix `MEMORY_` → no coincide con `REDIS_`, usamos `Field(alias=...)`
- Las credenciales no tienen prefijo común → usamos `Field(alias='ESTUDIO_CUIT')` directamente
- Esto mantiene **backward compatibility**: no renombramos ninguna env var existente

### Architecture Decision: Singleton vs fresh instance?

Usamos `functools.lru_cache` para que `get_settings()` sea singleton perezoso:

```python
@lru_cache
def get_settings() -> AppSettings:
    return AppSettings()
```

Esto evita recrear el objeto en cada import y permite testear con `monkeypatch` de pytest.

### Architecture Decision: MemoryConfig integration

`MemoryConfig` en `memory/config.py` ya funciona bien con su propio `env_prefix='MEMORY_'`. Le agregamos un constructor alternativo que acepte `RedisConfig` opcional, manteniendo compatibilidad total.

### Key Models (no new models — solo config)

| Model | Fields | Source |
|-------|--------|--------|
| `RedisConfig` | `url`, `cache_url`, `max_mb` | `REDIS_URL`, `MEMORY_REDIS_CACHE_URL`, `MEMORY_REDIS_MAX_MB` |
| `Credentials` | `cuit`, `clave_fiscal`, `composio_api_key` | `ESTUDIO_CUIT`, `ESTUDIO_CLAVE_FISCAL`, `COMPOSIO_API_KEY` |
| `AppSettings` | `redis`, `credentials` | agrega ambos sub-modelos |

### Files Changed

| File | Change |
|------|--------|
| `fiscal_agent/config.py` | **CREAR** — `RedisConfig`, `Credentials`, `AppSettings`, `get_settings()` |
| `fiscal_agent/memory/config.py` | MODIFICAR — agregar `from_config()` classmethod |
| `fiscal_agent/api/server.py` | MODIFICAR — usar `get_settings().redis.url` |
| `fiscal_agent/cli.py` | MODIFICAR — usar `get_settings().credentials.*` |
| `fiscal_agent/mcp/server.py` | MODIFICAR — usar `get_settings().credentials.*` |
| `fiscal_agent/api/deps.py` | MODIFICAR — usar `get_settings().credentials.cuit` |
| `fiscal_agent/api/routes/extract.py` | MODIFICAR — recibir credentials por parámetro |
| `fiscal_agent/api/routes/report.py` | MODIFICAR — recibir credentials por parámetro |

## Rollback Plan
1. Revertir `fiscal_agent/config.py` y las modificaciones a los archivos que lo importan
2. Los `os.getenv` originales siguen siendo válidos porque no cambiamos nombres de env vars
3. Sin cambios en `.env` → rollback es seguro

## Dependencies
- `pydantic-settings` (ya en `pyproject.toml`)
- Ninguna dependencia externa nueva
