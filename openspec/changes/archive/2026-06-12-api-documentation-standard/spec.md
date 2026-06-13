# API Documentation Standard

## Purpose

Enrich all FastAPI endpoint decorators and Pydantic request models with OpenAPI metadata — `response_model`, `summary`, error `responses`, `examples`, and tag documentation. Zero behavioral change: all modifications are purely declarative metadata for the generated OpenAPI 3.1 schema.

## ADDED Requirements

### Requirement: Endpoint response_model

Every endpoint MUST declare `response_model=UnifiedResponse[T]` typed to its result payload.

| Endpoint | response_model |
|---|---|
| GET /v1/health | `UnifiedResponse[dict]` |
| POST /v1/calendar | `UnifiedResponse[RulesOutput]` |
| GET /v1/taxpayer/{cuit} | `UnifiedResponse[PadronA5Output]` |
| POST /v1/report | `UnifiedResponse[dict]` |
| POST /v1/extract | `UnifiedResponse[DeudaOutput]` |
| POST /v1/admin/register | `UnifiedResponse[dict]` |
| POST /v1/admin/apps | `UnifiedResponse[dict]` |
| POST /v1/admin/keys | `UnifiedResponse[dict]` |
| GET /v1/admin/keys | `UnifiedResponse[dict]` |
| GET /v1/admin/me | `UnifiedResponse[Developer]` |

#### Scenario: response_model on every endpoint

- GIVEN the FastAPI app starts
- WHEN inspecting each route's OpenAPI schema entry
- THEN every endpoint MUST have a `response_model` matching the table above

### Requirement: Endpoint summary and error responses

Every endpoint MUST declare a `summary` string (≤ 80 chars) and a `responses` dict describing auth errors.

| Endpoint | summary | 401 | 403 | 429 |
|---|---|---|---|---|
| GET /v1/health | Server health check with ARCA TA status | — | — | ✅ |
| POST /v1/calendar | Calcular calendario fiscal para CUIT y período | ✅ | ✅ | ✅ |
| GET /v1/taxpayer/{cuit} | Obtener perfil del contribuyente desde Padrón A5 | ✅ | ✅ | ✅ |
| POST /v1/report | Ejecutar pipeline fiscal completo (calendario + PDF + email) | ✅ | ✅ | ✅ |
| POST /v1/extract | Extraer datos fiscales vía navegador | ✅ | ✅ | ✅ |
| POST /v1/admin/register | Registrar nueva cuenta de desarrollador | — | — | ✅ |
| POST /v1/admin/apps | Crear nueva aplicación | ✅ | ✅ | ✅ |
| POST /v1/admin/keys | Generar nueva API key para una app | ✅ | ✅ | ✅ |
| GET /v1/admin/keys | Listar API keys del desarrollador | ✅ | ✅ | ✅ |
| GET /v1/admin/me | Obtener perfil del desarrollador autenticado | ✅ | ✅ | ✅ |

Error descriptions:
- `401`: `"API key faltante o inválida — usar header Authorization: Bearer <key>"`
- `403`: `"API key inactiva o sin el scope requerido"`
- `429`: `"Límite de tasa excedido — reintentar según Retry-After"`

#### Scenario: Error responses in OpenAPI schema

- GIVEN an authenticated endpoint
- WHEN inspecting its `responses` in the OpenAPI schema
- THEN it MUST contain `401`, `403`, and `429` with the descriptions above

### Requirement: Request model field metadata

Every Pydantic request model field MUST have `Field(description=...)` and `Field(examples=[...])`.

#### CalendarRequest

| Field | description | examples |
|---|---|---|
| cuit | CUIT del contribuyente sin guiones | `["20301234561"]` |
| mes | Mes del período (1-12) | `[6]` |
| anio | Año del período (YYYY) | `[2025]` |
| idempotency_key | Clave opcional para evitar duplicados | `["cal-202506-abc123"]` |

#### ReportRequest

| Field | description | examples |
|---|---|---|
| cuit | CUIT del contribuyente sin guiones | `["20301234561"]` |
| mes | Mes del período (1-12) | `[6]` |
| anio | Año del período (YYYY) | `[2025]` |
| with_deuda | Incluir consulta de deuda en ARCA | `[true]` |
| with_facilidades | Incluir consulta de planes de pago | `[false]` |
| with_registro | Incluir consulta de registro tributario | `[false]` |
| send_email | Enviar reporte por email al finalizar | `[false]` |
| idempotency_key | Clave opcional para evitar duplicados | `["rep-202506-abc123"]` |

#### ExtractRequest

| Field | description | examples |
|---|---|---|
| cuit | CUIT del contribuyente sin guiones | `["20301234561"]` |
| tasks | Tareas de extracción a ejecutar | `[["deuda", "facilidades"]]` |
| idempotency_key | Clave opcional para evitar duplicados | `["ext-202506-abc123"]` |

#### Admin request models

| Model | Field | description | examples |
|---|---|---|---|
| RegisterRequest | name | Nombre del desarrollador | `["Juan Pérez"]` |
| RegisterRequest | email | Email del desarrollador | `["juan@estudio.com"]` |
| CreateAppRequest | name | Nombre de la aplicación | `["Mi App Contable"]` |
| CreateAppRequest | environment | Entorno de la aplicación | `["sandbox"]` |
| CreateKeyRequest | app_id | ID de la aplicación destino | `["app_abc123"]` |

#### Scenario: Field metadata in OpenAPI schema

- GIVEN a Pydantic request model used by any endpoint
- WHEN inspecting its JSON Schema in OpenAPI
- THEN every field MUST have both `description` and `examples`

### Requirement: OpenAPI server metadata

The FastAPI app MUST expose through an `app.openapi()` hook or constructor params:
- `servers`: `[{"url": "http://localhost:8000", "description": "Local development"}]`
- `contact.name`: `"Fiscal Agent Team"`
- `contact.url`: project repository URL
- Tag descriptions for all 6 tags: `health`, `calendar`, `report`, `extract`, `admin`
- OAuth2 security scheme `oauth2` (type `oauth2`, flow `authorizationCode`, placeholder for Auth0)

#### Scenario: OpenAPI schema structure

- GIVEN the FastAPI application is running
- WHEN fetching `/openapi.json`
- THEN the schema MUST contain `servers`, `info.contact`, `info.description`, per-tag `description`, and `components.securitySchemes.oauth2`

### Coverage

- Happy paths: ✅ Covered (per-endpoint response_model + summary)
- Edge cases: ✅ Covered (error code descriptions 401/403/429)
- Error states: ✅ Covered (structured per auth and rate-limit errors)

## Next Step

Ready for design (sdd-design).
