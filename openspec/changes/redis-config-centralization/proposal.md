# Proposal: Redis Config Centralization

## Intent
Centralizar toda la configuración de Redis (y variables de entorno relacionadas) en un módulo `fiscal_agent/config.py` usando Pydantic `BaseSettings`, eliminando los `os.getenv` dispersos por el código base.

## Motivation
Hoy hay **44 calls a `os.getenv` / `os.environ.get`** esparcidas por 12+ archivos. Redis tiene **dos URLs distintas** (`REDIS_URL` para async en server.py, `MEMORY_REDIS_CACHE_URL` para sync en memory/config.py) sin un punto único de definición. Esto hace que:
- Cambiar una variable requiera buscar en múltiples archivos
- Los defaults estén inconsistentes
- No haya un solo lugar donde entender qué configuración necesita el proyecto

## Scope
- Crear `fiscal_agent/config.py` con Pydantic `BaseSettings`
- Consolidar `RedisConfig` (ambas URLs async + sync)
- Agrupar credenciales: `ESTUDIO_CUIT`, `ESTUDIO_CLAVE_FISCAL`, `COMPOSIO_API_KEY`
- Mantener `MemoryConfig` en `memory/config.py` pero alimentado desde el config central
- Actualizar `api/server.py`, `cli.py`, `mcp/server.py` para usar el nuevo config
- Auth0 queda fuera (próximo ciclo)

## Out of Scope
- Auth0 configuration
- SMTP configuration
- NVIDIA configuration
- Cambios en la lógica de negocio

## Success Criteria
- [x] `fiscal_agent/config.py` existe con `RedisConfig` y `AppSettings`
- [x] `api/server.py` obtiene `REDIS_URL` desde el config central
- [x] `memory/config.py` obtiene `redis_cache_url` desde el config central
- [x] `cli.py` usa `AppSettings` para credenciales
- [x] Todos los tests existentes pasan (sin cambios de comportamiento)
- [x] Las variables de entorno actuales siguen funcionando (backward compatible)
