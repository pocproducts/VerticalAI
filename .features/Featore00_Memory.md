# FEATURE: Engram Memory + Dockerización — Fiscal Agent

## Contexto del proyecto

Fiscal Agent es un monolito Python que automatiza el ciclo fiscal mensual para
estudios contables argentinos. El pipeline es:

CUIT → ARCA WS (Padrón A5) → Rules Engine (vencimientos) →
Browser Agent (deuda/planes/registro) → PDF → Email

El proyecto ya usa Redis para persistencia operacional (API keys, developers,
rate limiting). Redis NO se toca. Engram es una capa nueva de memoria semántica
del agente, completamente separada de Redis.

## Stack actual relevante

- Python con uv como package manager
- FastAPI (REST API)
- FastMCP (MCP Server)
- Typer (CLI)
- Composio (browser automation)
- Redis (operacional — no tocar)
- ReportLab (PDF)
- Pydantic v2 para modelos

## Objetivo

Implementar dos features juntos:

1. Memoria semántica persistente con Engram (nuevo módulo `memory/`)
2. Dockerización completa del proyecto (Dockerfile + docker-compose.yml)

---

## FEATURE 1: Módulo de memoria con Engram

### Qué es Engram

Engram es un binario Go que corre como proceso separado y expone una HTTP API
en el puerto 7437. Persiste memorias en SQLite + archivos Markdown. El monolito
Python le habla únicamente por HTTP con `requests`. No hay SDK, no hay binding
Go-Python.

### Estructura a crear
fiscal_agent/
└── memory/
├── _init_.py
├── config.py # MemoryConfig con pydantic BaseSettings
└── client.py # FiscalMemoryClient class

text

### Reglas de implementación del cliente

El `agent_id` de cada operación con Engram es el **CUIT del contribuyente**.
Así la memoria está acotada por contribuyente.

El cliente debe tener estos métodos:

**WRITE (guardar después de cada etapa del pipeline):**
- `save_padron_result(cuit, padron_data, status)` → después de ARCA WS
- `save_extraction_result(cuit, extraction_type, data, status)` →
  después de Browser Agent (deuda / facilidades / registro, uno por tipo)
- `save_pdf_sent(cuit, pdf_path, email_sent_to, status)` →
  después de PDF + email
- `save_pipeline_error(cuit, stage, error_message)` →
  si falla cualquier etapa

**READ (consultar antes de cada etapa):**
- `get_padron_history(cuit, limit=3)` → antes de consultar ARCA WS,
  para saber si hay datos recientes
- `get_extraction_history(cuit, extraction_type, limit=3)` →
  antes de browser automation
- `get_pipeline_history(cuit, limit=10)` → historial completo del CUIT
- `get_last_error(cuit, stage)` → saber si la última ejecución falló

**HELPERS:**
- `is_available()` → health check a Engram
- `_redis_has_space()` → verifica que Redis cache no supere 25MB

### Estrategia Redis como cache de Engram

Redis (free tier 30MB) actúa como cache caliente de las consultas frecuentes
a Engram. NO reemplaza a Engram, solo acelera lecturas repetidas.

Regla: cachear en Redis SOLO los resultados de búsqueda frecuentes
(padrón del CUIT, historial de extracciones). Las conversaciones y errores
van solo a Engram, nunca a Redis cache.

TTL de cache:
- Padrón A5: 24 horas (cambia poco)
- Extracciones: 7 días
- Historial pipeline: 1 hora

### Integración en el pipeline (cli.py)

En `cli.py`, en el método que orquesta el pipeline por CUIT, agregar:

1. **Antes de ARCA WS**: consultar `get_padron_history(cuit)`. Si hay datos
   de menos de 24 horas, loggear que se reusan (no saltear la consulta,
   solo informar).
2. **Después de ARCA WS exitoso**: `save_padron_result(cuit, data, "success")`
3. **Después de cada extracción browser**: `save_extraction_result(...)`
4. **Después de PDF + email**: `save_pdf_sent(...)`
5. **En cualquier except del pipeline**: `save_pipeline_error(cuit, stage, error)`

La memoria es best-effort: si Engram no está disponible
(`is_available()` retorna False), el pipeline continúa igual sin memoria.
Nunca debe bloquear el pipeline principal.

### Config (.env variables nuevas a agregar)
MEMORY_ENGRAM_URL=http://engram:7437 # Docker internal DNS
MEMORY_REDIS_CACHE_URL= # misma Redis existente
MEMORY_REDIS_MAX_MB=25
MEMORY_ENGRAM_TIMEOUT=10

text

---

## FEATURE 2: Dockerización

### Servicios en docker-compose.yml

Tres servicios:

**1. fiscal-agent** (monolito Python)
- Build desde Dockerfile local
- Depende de: redis, engram
- Variables de entorno desde .env
- Volumen para output de PDFs generados
- Expone puerto 8000 (API REST) y 8001 (MCP HTTP si aplica)

**2. engram** (memoria semántica)
- Imagen: `ghcr.io/gentleman-programming/engram:latest` o
  `cylian/engram` (verificar cuál está disponible en Docker Hub)
- Puerto interno: 7437 (o 18080 según la imagen, verificar)
- Volumen persistente nombrado: `engram-data` montado en `/knowledge`
  o donde la imagen lo requiera
- Variable `ENGRAM_CLOUD_INSECURE_NO_AUTH=1` para no requerir auth local
- Restart: always (crítico para persistencia entre reinicios)

**3. redis** (ya existe en el proyecto, solo formalizar)
- Imagen: `redis:7-alpine`
- Puerto: 6379
- Volumen persistente nombrado: `redis-data`
- Restart: always

### Dockerfile del monolito

- Base: `python:3.11-slim`
- Package manager: `uv` (instalar con pip, luego usar uv para deps)
- Copiar `pyproject.toml` y `uv.lock` primero (layer caching)
- Luego copiar `fiscal_agent/`
- Crear directorio `/app/output` para PDFs
- Entry point: `python -m fiscal_agent`

### Volúmenes persistentes

```yaml
volumes:
  engram-data:    # memorias SQLite + Markdown de Engram
  redis-data:     # datos operacionales Redis
  pdf-output:     # PDFs generados por el pipeline
```

Los volúmenes nombrados de Docker persisten entre reinicios del container.
Este es el mecanismo de persistencia entre reinicios para Engram.

### .env.example actualizado

Agregar las variables nuevas de memoria al `.env.example` existente,
sin pisar las variables que ya existen.

### Health checks

En docker-compose.yml agregar healthcheck a los tres servicios:
- **redis**: `redis-cli ping`
- **engram**: `curl -f http://localhost:7437/health || exit 1`
  (ajustar puerto según imagen)
- **fiscal-agent**: `curl -f http://localhost:8000/v1/health || exit 1`

---

## Restricciones importantes

1. NO modificar la lógica de Redis operacional existente
   (store.py, rate_limiter.py, auth.py). Engram es una capa nueva, aditiva.
2. La memoria es siempre best-effort. Si Engram falla, el pipeline no falla.
3. Usar `agent_id = cuit` en todas las operaciones con Engram.
4. El módulo `memory/` no debe importar nada del resto del proyecto
   (sin imports circulares). Solo usa `requests`, `redis`, `pydantic`.
5. Verificar la imagen Docker correcta de Engram y el puerto que expone
   antes de hardcodear en docker-compose.yml.
6. El proyecto usa `uv`, no `pip` directamente. El Dockerfile debe
   respetar esto.

## Entregables esperados

1. `fiscal_agent/memory/__init__.py`
2. `fiscal_agent/memory/config.py`
3. `fiscal_agent/memory/client.py`
4. Modificaciones en `fiscal_agent/cli.py` (integración en pipeline)
5. `Dockerfile`
6. `docker-compose.yml`
7. `.env.example` actualizado (solo agregar variables nuevas)
8. Actualización de `pyproject.toml` si se agregan dependencias nuevas
   (`requests` si no está, `redis` si no está)