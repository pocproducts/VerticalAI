# Design: API Documentation Standard

## 1. Executive Summary

Enrich FastAPI's auto-generated OpenAPI 3.1 schema with metadata — `response_model`,
`responses`, `summary`, `Field(examples=...)`, and schema-level configuration (servers,
contact, security scheme, tag descriptions). Pure metadata change, zero behavioral
impact. All existing tests must pass unmodified.

## 2. OpenAPI Configuration Pattern (`server.py`)

### 2.1 Custom OpenAPI Hook

Replace the default `app.openapi` with a function that enriches the schema generated
by `fastapi.openapi.utils.get_openapi()`. Follow FastAPI's cached-schema pattern:

```python
from fastapi.openapi.utils import get_openapi


def custom_openapi() -> dict:
    if app.openapi_schema:
        return app.openapi_schema

    openapi_schema = get_openapi(
        title='Fiscal Agent API',
        version='2.0.0',
        description='Vertical AI Agent Fiscal — API REST para agentes e integraciones',
        routes=app.routes,
    )

    # ── Contact Info ───────────────────────────────────────────
    openapi_schema['info']['contact'] = {
        'name': 'Fiscal Agent Team',
        'url': 'https://fiscal-agent.ar',
        'email': 'dev@fiscal-agent.ar',
    }

    # ── Servers ────────────────────────────────────────────────
    openapi_schema['servers'] = [
        {'url': 'http://localhost:8000', 'description': 'Desarrollo local'},
        {'url': 'https://api.fiscal-agent.ar', 'description': 'Producción'},
    ]

    # ── Security Scheme (Auth0 placeholder) ────────────────────
    openapi_schema['components']['securitySchemes'] = {
        'Auth0OAuth2': {
            'type': 'oauth2',
            'flows': {
                'authorizationCode': {
                    'authorizationUrl': 'https://{tenant}.auth0.com/authorize',
                    'tokenUrl': 'https://{tenant}.auth0.com/oauth/token',
                    'scopes': {
                        'calendar:read': 'Leer calendario fiscal',
                        'calendar:write': 'Generar calendario fiscal',
                        'taxpayer:read': 'Consultar datos del contribuyente',
                        'report:read': 'Leer reportes',
                        'report:write': 'Generar reportes',
                        'admin:read': 'Leer datos de administración',
                        'admin:write': 'Operaciones de administración',
                    },
                },
            },
        },
    }
    openapi_schema['security'] = [{'Auth0OAuth2': []}]

    # ── Tags with descriptions ─────────────────────────────────
    openapi_schema['tags'] = [
        {
            'name': 'health',
            'description': 'Endpoints de monitoreo y health check',
        },
        {
            'name': 'calendar',
            'description': 'Generación de calendarios fiscales por CUIT y período',
        },
        {
            'name': 'report',
            'description': 'Reportes fiscales completos e información de contribuyentes',
        },
        {
            'name': 'extract',
            'description': 'Extracción automatizada de datos vía navegador (Composio)',
        },
        {
            'name': 'admin',
            'description': 'Autogestión de desarrolladores, aplicaciones y API keys',
        },
    ]

    app.openapi_schema = openapi_schema
    return app.openapi_schema


app.openapi = custom_openapi
```

Place this block in `server.py` before `app.include_router(...)` calls (or right after
`app = FastAPI(...)` — order matters only for the cached schema pattern).

### 2.2 Tags

The tag names (`'health'`, `'calendar'`, `'report'`, `'extract'`, `'admin'`) must match
the `tags` argument in `app.include_router(...)` calls exactly. Those are:

| Router | Tag | `include_router` call |
|--------|-----|-----------------------|
| `health.router` | `'health'` | `app.include_router(health.router, tags=['health'])` |
| `calendar.router` | `'calendar'` | `app.include_router(calendar.router, tags=['calendar'])` |
| `report.router` | `'report'` | `app.include_router(report.router, tags=['report'])` |
| `extract.router` | `'extract'` | `app.include_router(extract.router, tags=['extract'])` |
| `admin.router` | `'admin'` | `app.include_router(admin.router, tags=['admin'])` |

No changes needed to `include_router` calls. Tags already match.

## 3. Route Enrichment Pattern

### 3.1 Generic Pattern

Every endpoint decorator gains three additions:

```python
@router.get(
    '/v1/some-path',
    response_model=UnifiedResponse[DomainModel],
    summary='Descripción corta en español',
    responses={
        401: {'description': 'API key faltante o inválida', 'model': UnifiedResponse[ApiError]},
        403: {'description': 'Scope insuficiente o key inactiva', 'model': UnifiedResponse[ApiError]},
        429: {'description': 'Límite de tasa excedido', 'model': UnifiedResponse[ApiError]},
    },
)
async def handler(...):
    """Descripción más larga en español (se convierte en `description` en OpenAPI).

    Aparece como texto completo en la operación de la spec.
    """
```

#### 3.1.1 `response_model` rules

| Result type | `response_model` |
|-------------|------------------|
| `result` is a typed Pydantic model (e.g. `RulesOutput`, `PadronA5Output`, `DeudaOutput`, `Developer`) | `UnifiedResponse[ThatModel]` |
| `result` has dynamic/adhoc keys (e.g. `{'status': ..., 'ta_vigente': ...}`) | `UnifiedResponse[dict]` |
| Error-only endpoints (no success `result`) | `UnifiedResponse[None]` — none of our endpoints fall here |

#### 3.1.2 `responses` rules

- **401**: Always included — auth middleware raises this
- **403**: Always included — scope check and inactive key raise this
- **429**: Always included — rate limiter placeholder for future use

The `model` for all three is `UnifiedResponse[ApiError]` (the `error` field is
`ApiError | None`).

#### 3.1.3 `summary` and docstring

- Use **explicit `summary`** parameter on the decorator (short, Spanish, ~5-8 words)
- Keep the **docstring in Spanish** — FastAPI uses it as `description`
- Endpoints currently use English docstrings; all MUST be translated to Spanish

### 3.2 Per-Endpoint Mapping

#### `health.py`

| Field | Value |
|-------|-------|
| `response_model` | `UnifiedResponse[dict]` — result has dynamic `status`, `timestamp`, `ta_vigente` keys |
| `summary` | `'Health check del agente'` |
| `responses` | `{401, 403, 429}` standard error set |
| Docstring (ES) | `"Health check del agente. Retorna estado del servidor, timestamp y validez del Ticket de Acceso (TA) de ARCA."` |

No auth dependency → 401/403 are unlikely but kept for consistency.

#### `calendar.py`

| Field | Value |
|-------|-------|
| `response_model` | `UnifiedResponse[RulesOutput]` — `engine.calcular()` returns `RulesOutput` |
| `summary` | `'Generar calendario fiscal'` |
| `responses` | `{401, 403, 429}` standard error set |
| Docstring (ES) | `"Genera el calendario fiscal para un CUIT y período determinados. Consulta el Padrón A5 de ARCA y aplica las reglas de vencimientos fiscales."` |

#### `report.py` — GET `/v1/taxpayer/{cuit}`

| Field | Value |
|-------|-------|
| `response_model` | `UnifiedResponse[PadronA5Output]` — `padron_result.to_output()` returns `PadronA5Output` |
| `summary` | `'Consultar contribuyente en ARCA'` |
| `responses` | `{401, 403, 429}` standard error set |
| Docstring (ES) | `"Obtiene el perfil completo de un contribuyente desde el Padrón A5 de ARCA. Incluye domicilio fiscal, actividades económicas, impuestos inscriptos y categoría."` |

#### `report.py` — POST `/v1/report`

| Field | Value |
|-------|-------|
| `response_model` | `UnifiedResponse[dict]` — result has `pdf_path`, `email_sent`, `ws_api`, `calendario`, `next_actions` |
| `summary` | `'Ejecutar pipeline fiscal completo'` |
| `responses` | `{401, 403, 429}` standard error set |
| Docstring (ES) | `"Ejecuta el pipeline fiscal completo para un CUIT y período: calcula calendario, genera PDF, extrae datos vía navegador y envía email si está configurado."` |

#### `extract.py`

| Field | Value |
|-------|-------|
| `response_model` | `UnifiedResponse[DeudaOutput]` — `browser.run_single()` returns `DeudaOutput` |
| `summary` | `'Extraer datos por navegador automatizado'` |
| `responses` | `{401, 403, 429}` standard error set |
| Docstring (ES) | `"Extrae datos del contribuyente usando navegador automatizado (Composio). Soporta: deuda (ctacte.cloud), facilidades (Mis Facilidades) y registro (RUT)."` |

#### `admin.py` — POST `/v1/admin/register`

| Field | Value |
|-------|-------|
| `response_model` | `UnifiedResponse[Developer]` — `register_developer()` returns `Developer` |
| `summary` | `'Registrar nuevo desarrollador'` |
| `responses` | `{401, 403, 429}` standard — though this endpoint has NO auth dependency, kept for consistency |
| Docstring (ES) | `"Registra una nueva cuenta de desarrollador. Endpoint público sin autenticación."` |

#### `admin.py` — POST `/v1/admin/apps`

| Field | Value |
|-------|-------|
| `response_model` | `UnifiedResponse[App]` — `create_app()` returns `App` |
| `summary` | `'Crear nueva aplicación'` |
| `responses` | `{401, 403, 429}` standard |
| Docstring (ES) | `"Crea una nueva aplicación para el desarrollador autenticado."` |

#### `admin.py` — POST `/v1/admin/keys`

| Field | Value |
|-------|-------|
| `response_model` | `UnifiedResponse[dict]` — `create_api_key()` returns dict with `api_key`, `full_key`, `warning` |
| `summary` | `'Generar nueva API key'` |
| `responses` | `{401, 403, 429}` standard |
| Docstring (ES) | `"Genera una nueva API key para una aplicación. La clave completa se muestra una sola vez."` |

#### `admin.py` — GET `/v1/admin/keys`

| Field | Value |
|-------|-------|
| `response_model` | `UnifiedResponse[dict]` — result has `{'keys': keys}` |
| `summary` | `'Listar API keys del desarrollador'` |
| `responses` | `{401, 403, 429}` standard |
| Docstring (ES) | `"Lista todas las API keys del desarrollador autenticado."` |

#### `admin.py` — GET `/v1/admin/me`

| Field | Value |
|-------|-------|
| `response_model` | `UnifiedResponse[Developer]` — `req.state.developer` is a `Developer` |
| `summary` | `'Perfil del desarrollador autenticado'` |
| `responses` | `{401, 403, 429}` standard |
| Docstring (ES) | `"Obtiene el perfil del desarrollador autenticado."` |

## 4. Model Enrichment Pattern

### 4.1 Inline Request Models (route files)

Add `Field(description=..., examples=[...])` to every field in all request models.

**Rule**: Every request model field MUST have:
- `description` — explains the field in Spanish
- `examples` — at least one realistic example value

Exception: `idempotency_key` can omit `ge`/`le`/`pattern` — it's an opaque string.

#### `calendar.py` — `CalendarRequest`

```python
class CalendarRequest(BaseModel):
    """Solicitud de generación de calendario fiscal."""

    cuit: str = Field(
        description='CUIT del contribuyente (formato XX-XXXXXXXX-X)',
        examples=['20-30112233-4'],
    )
    mes: int = Field(
        description='Mes del período fiscal (1-12)',
        ge=1, le=12,
        examples=[6],
    )
    anio: int = Field(
        description='Año del período fiscal (YYYY)',
        ge=2020, le=2099,
        examples=[2026],
    )
    idempotency_key: Optional[str] = Field(
        default=None,
        description='Key de idempotencia para evitar procesamiento duplicado',
        examples=['cal-2026-06-abc123'],
    )
```

#### `report.py` — `ReportRequest`

```python
class ReportRequest(BaseModel):
    """Solicitud de pipeline fiscal completo."""

    cuit: str = Field(
        description='CUIT del contribuyente',
        examples=['20-30112233-4'],
    )
    mes: int = Field(
        description='Mes del período fiscal (1-12)',
        ge=1, le=12,
        examples=[6],
    )
    anio: int = Field(
        description='Año del período fiscal',
        ge=2020, le=2099,
        examples=[2026],
    )
    with_deuda: bool = Field(
        default=False,
        description='Incluir extracción de deuda vía navegador',
        examples=[True],
    )
    with_facilidades: bool = Field(
        default=False,
        description='Incluir consulta de Mis Facilidades',
        examples=[False],
    )
    with_registro: bool = Field(
        default=False,
        description='Incluir consulta de Registro Tributario',
        examples=[False],
    )
    send_email: bool = Field(
        default=False,
        description='Enviar el reporte por email al cliente',
        examples=[False],
    )
    idempotency_key: Optional[str] = Field(
        default=None,
        description='Key de idempotencia',
        examples=['rpt-2026-06-abc123'],
    )
```

#### `extract.py` — `ExtractRequest`

```python
class ExtractRequest(BaseModel):
    """Solicitud de extracción de datos vía navegador."""

    cuit: str = Field(
        description='CUIT del contribuyente',
        examples=['20-30112233-4'],
    )
    tasks: List[str] = Field(
        description='Tareas a ejecutar: "deuda", "facilidades", "registro"',
        examples=[['deuda', 'facilidades']],
    )
    idempotency_key: Optional[str] = Field(
        default=None,
        description='Key de idempotencia',
        examples=['ext-2026-06-abc123'],
    )
```

#### `admin.py` — `RegisterRequest`

```python
class RegisterRequest(BaseModel):
    """Solicitud de registro de nuevo desarrollador."""

    name: str = Field(
        description='Nombre completo del desarrollador o estudio',
        examples=['Estudio Contable Pérez'],
    )
    email: str = Field(
        description='Correo electrónico del desarrollador',
        examples=['contacto@estudioperez.com'],
    )
```

#### `admin.py` — `CreateAppRequest`

```python
class CreateAppRequest(BaseModel):
    """Solicitud de creación de nueva aplicación."""

    name: str = Field(
        description='Nombre de la aplicación',
        examples=['Sistema de Gestión Pérez'],
    )
    environment: str = Field(
        default='sandbox',
        description='Entorno: "sandbox" para pruebas, "production" para producción',
        examples=['sandbox', 'production'],
    )
```

#### `admin.py` — `CreateKeyRequest`

```python
class CreateKeyRequest(BaseModel):
    """Solicitud de generación de API key."""

    app_id: str = Field(
        description='ID de la aplicación',
        examples=['a1b2c3d4e5f6'],
    )
```

### 4.2 Models in `models.py`

Add `Field(description=...)` to models that appear in the API schema.
**No `examples` on response models** — they are server-generated.

#### `ApiError`

```python
class ApiError(BaseModel):
    """Error estructurado para respuestas de API."""

    code: str = Field(description='Código de error machine-readable (ej: TA_UNAVAILABLE)')
    cause: str = Field(description='Descripción legible de la causa del error')
    remediation: str = Field(default='', description='Sugerencia para resolver el error (opcional)')
```

#### `UnifiedResponse`

```python
class UnifiedResponse(BaseModel, Generic[T]):
    """Envoltorio genérico para todas las respuestas de la API."""

    status: Literal['success', 'error', 'pending', 'requires_approval'] = Field(
        description='Estado de la operación',
    )
    result: T | None = Field(
        default=None,
        description='Datos de la respuesta (según el endpoint)',
    )
    next_actions: list[str] = Field(
        default=[],
        description='Acciones sugeridas para el agente',
    )
    human_approval_required: bool = Field(
        default=False,
        description='Indica si se requiere aprobación humana para continuar',
    )
    error: ApiError | None = Field(
        default=None,
        description='Error estructurado (presente solo si status=error)',
    )
```

#### `IdempotentRequest`

```python
class IdempotentRequest(BaseModel):
    """Mixin para operaciones que soportan idempotencia."""

    idempotency_key: str | None = Field(
        default=None,
        description='Clave única de idempotencia para evitar procesamiento duplicado',
    )
```

### 4.3 What Does NOT Change

All domain/response models (`RulesOutput`, `DeudaOutput`, `PadronA5Output`,
`Vencimiento`, `ClientConfig`, `AppConfig`, `Developer`, `App`, `ApiKey`, `Plan`, etc.)
already have adequate `Field(description=...)` where needed. They are response models
and should NOT receive `examples`.

## 5. Security Scheme

### 5.1 OpenAPI Structure

Defined in the custom OpenAPI hook (section 2.1):

- **Scheme name**: `Auth0OAuth2`
- **Type**: `oauth2`
- **Flow**: `authorizationCode`
- **Authorization URL**: `https://{tenant}.auth0.com/authorize`
- **Token URL**: `https://{tenant}.auth0.com/oauth/token`
- **Scopes**: Mirrors the `Scope` enum in `models.py`

### 5.2 Scope Mapping

| `Scope` enum value | OpenAPI scope | Descripción |
|--------------------|---------------|-------------|
| `calendar:read` | `calendar:read` | Leer calendario fiscal |
| `calendar:write` | `calendar:write` | Generar calendario fiscal |
| `taxpayer:read` | `taxpayer:read` | Consultar datos del contribuyente |
| `report:read` | `report:read` | Leer reportes |
| `report:write` | `report:write` | Generar reportes |
| `admin:read` | `admin:read` | Leer datos de administración |
| `admin:write` | `admin:write` | Operaciones de administración |

The default `security` is `[{'Auth0OAuth2': []}]` (no scopes required at schema level
— individual endpoints enforce via `ScopeRequired`).

### 5.3 Important Notes

- This is a **placeholder only**. No Auth0 SDK, no token validation, no JWKS
  retrieval. The actual security scheme URL uses `{tenant}` as a placeholder.
- Current auth is API-key-based via `HTTPBearer`. The OAuth2 security scheme in
  OpenAPI documents the intended production auth model without changing the runtime.
- The `ScopeRequired` dependency and `HTTPBearer` security remain the actual
  authentication mechanism.

## 6. File Changes Plan

### Summary Table

| File | Change | Type |
|------|--------|------|
| `fiscal_agent/api/server.py` | Add `custom_openapi()` function + `app.openapi = custom_openapi` | Enrich |
| `fiscal_agent/api/routes/health.py` | Add `response_model`, `summary`, `responses` to decorator; translate docstring to ES; add `Field` to inline model | Enrich |
| `fiscal_agent/api/routes/calendar.py` | Same pattern; add `Field(examples=..., description=...)` to `CalendarRequest` | Enrich |
| `fiscal_agent/api/routes/report.py` | Same pattern on both endpoints; add `Field(...)` to `ReportRequest` | Enrich |
| `fiscal_agent/api/routes/extract.py` | Same pattern; add `Field(...)` to `ExtractRequest` | Enrich |
| `fiscal_agent/api/routes/admin.py` | Same pattern on all 5 endpoints; add `Field(...)` to `RegisterRequest`, `CreateAppRequest`, `CreateKeyRequest` | Enrich |
| `fiscal_agent/models.py` | Add `Field(description=...)` to `ApiError`, `UnifiedResponse`, `IdempotentRequest` | Enrich |

### Order of Implementation

1. **`models.py`** — enrich `ApiError`, `UnifiedResponse`, `IdempotentRequest` with
   `Field(description=...)` (pure model changes, no import dependency)
2. **`server.py`** — add `custom_openapi()` hook and `app.openapi = custom_openapi`
3. **Route files** — enrich decorators and inline models (order doesn't matter; they
   are independent of each other)

### Files NOT Modified

- `fiscal_agent/api/auth.py` — no change needed
- `fiscal_agent/api/rate_limiter.py` — no change needed
- `fiscal_agent/api/deps.py` — no change needed
- `fiscal_agent/api/store.py` — no change needed

## 7. Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| `response_model=UnifiedResponse[ModelType]` causes FastAPI schema gen error for certain generics | Low | Pydantic v2 handles parameterized generics natively. All response model types are concrete models or `dict` |
| Long `examples` lists bloat the generated schema | Low | One example per field. No multi-example arrays needed |
| Syncing `securitySchemes.scopes` with `Scope` enum drifts over time | Medium | Add a comment referencing `models.Scope` in the OpenAPI hook so developers remember to update both |
| Docstring translation to Spanish introduces typos or awkward phrasing | Low | Use simple, direct Spanish. Review before committing |

## 8. Verification

After implementation, run these checks (no behavioral tests needed — this is metadata):

```bash
# 1. Server starts without errors
uv run uvicorn fiscal_agent.api.server:app --reload &
sleep 2

# 2. OpenAPI schema is served
curl -s http://localhost:8000/openapi.json | python -m json.tool > /tmp/schema.json

# 3. Verify contact info present
python -c "import json; s=json.load(open('/tmp/schema.json')); assert s['info'].get('contact')"

# 4. Verify servers present
python -c "import json; s=json.load(open('/tmp/schema.json')); assert len(s.get('servers',[]))==2"

# 5. Verify security scheme present
python -c "import json; s=json.load(open('/tmp/schema.json')); assert 'Auth0OAuth2' in s['components']['securitySchemes']"

# 6. Verify tags have descriptions
python -c "import json; s=json.load(open('/tmp/schema.json')); assert all(t.get('description') for t in s.get('tags',[]))"

# 7. Verify all paths have response_model, summary, and error responses
python -c "
import json
s=json.load(open('/tmp/schema.json'))
for path, methods in s['paths'].items():
    for method, op in methods.items():
        assert '$ref' not in op, f'{path} {method} has \$ref instead of inline'
        assert 'summary' in op, f'{path} {method} missing summary'
        assert op.get('responses',{}).get('401'), f'{path} {method} missing 401'
        assert op.get('responses',{}).get('403'), f'{path} {method} missing 403'
"

# 8. Existing tests pass
uv run pytest
```

## 9. Rollback

Revert the single commit. No data migration, no behavioral trace, no cache invalidation.

```bash
git revert HEAD
```
