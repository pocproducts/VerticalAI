# Spec: chat-backend

## Purpose

Intent router and response builder for natural-language fiscal queries. Maps user messages to existing REST endpoints, builds human-readable replies from structured data. No LLM involved.

## Requirements

### Requirement: POST /v1/chat/message

The system MUST accept chat messages and return structured replies.

#### Request format

The request body MUST contain:
- `message` (str, required): Natural language query from the user
- `conversation_id` (str | null, optional): Opaque identifier for conversation continuation. The server MUST generate one if omitted.
- `history` (list[dict] | null, optional): Previous messages. Each entry MUST have `role` ("user" | "assistant") and `content` (str).

#### Response format

The response MUST contain:
- `conversation_id` (str): Echoed or newly-generated conversation identifier
- `reply` (str): Human-readable response text in Spanish
- `actions_taken` (list[str]): Internal actions performed (e.g., `["consultar_cuit"]`)
- `data` (dict | null): Structured results from backend queries (PadronA5Output, DeudaOutput, RulesOutput, etc.)

#### Intent routing

The system MUST detect CUIT (11 digits, optionally with hyphens) and intent via regex, then dispatch to internal functions that reuse existing endpoint logic.

| Intent | Trigger | Internal Action |
|--------|---------|-----------------|
| taxpayer | consulta / datos / padron / contribuyente + CUIT | consultar_cuit |
| calendar | calendario / vencimientos / vto + CUIT + mes/año | consultar_calendario |
| debt | deuda / saldo + CUIT | consultar_deuda |
| facilidades | facilidades / plan / cuotas + CUIT | consultar_facilidades |
| registro | registro / impuestos / actividades + CUIT | consultar_registro |
| report | reporte / completo / resumen + CUIT | generar_reporte |

#### Scenario: Consulta CUIT

- GIVEN a message like "consulta datos del contribuyente 20-32483779-6"
- WHEN POST /v1/chat/message processes it
- THEN `actions_taken` MUST contain `"consultar_cuit"`
- AND `data` MUST contain PadronA5Output fields (nombre, tipo, domicilio)

#### Scenario: Consulta deuda

- GIVEN a message like "deuda de 20324837796"
- WHEN POST /v1/chat/message processes it
- THEN `actions_taken` MUST contain `"consultar_deuda"`
- AND `reply` MUST include the total debt amount in natural language

#### Scenario: Consulta calendario

- GIVEN a message like "calendario junio 2026 20324837796"
- WHEN POST /v1/chat/message processes it
- THEN `actions_taken` MUST contain `"consultar_calendario"`
- AND `data` MUST contain RulesOutput with vencimientos list

#### Scenario: Consulta facilidades

- GIVEN a message like "facilidades de pago 20324837796"
- WHEN POST /v1/chat/message processes it
- THEN `actions_taken` MUST contain `"consultar_facilidades"`
- AND `reply` MUST list active payment plans with next due date

#### Scenario: Consulta registro

- GIVEN a message like "registro tributario 20324837796"
- WHEN POST /v1/chat/message processes it
- THEN `actions_taken` MUST contain `"consultar_registro"`
- AND `data` MUST contain RegistroOutput (domicilios, actividades, impuestos)

#### Scenario: Reporte completo

- GIVEN a message like "reporte completo 20324837796"
- WHEN POST /v1/chat/message processes it
- THEN `actions_taken` MUST contain `"generar_reporte"`
- AND `reply` MUST indicate the report was generated

#### Scenario: Mensaje sin CUIT

- GIVEN a message without any valid CUIT pattern
- WHEN POST /v1/chat/message processes it
- THEN `reply` MUST prompt the user to provide a CUIT
- AND `actions_taken` MUST be an empty list

#### Scenario: Mensaje irreconocible

- GIVEN a message with no matching intent keywords
- WHEN POST /v1/chat/message processes it
- THEN `reply` MUST list supported query types
- AND `actions_taken` MUST be an empty list

#### Scenario: Error de backend interno

- GIVEN a backend service (taxpayer, extract, calendar) returns an error
- WHEN POST /v1/chat/message processes the error response
- THEN `reply` MUST include the error in Spanish
- AND `actions_taken` MUST include the attempted action name

### Requirement: POST /v1/chat/message/stream

The system MUST stream chat message processing progress via Server-Sent Events (SSE), replicating the same pipeline logic as `POST /v1/chat/message` but delivering incremental progress.

#### Request format

The request body MUST use the same `ChatRequest` model as `POST /v1/chat/message`:
- `message` (str, required): Natural language query from the user
- `conversation_id` (str | null, optional): Opaque identifier for conversation continuation. The server MUST generate one if omitted.
- `history` (list[dict] | null, optional): Previous messages.

#### Response format

The endpoint MUST return `text/event-stream` with the following headers:
- `Cache-Control: no-cache`
- `Connection: keep-alive`
- `X-Accel-Buffering: no`

Each SSE event follows the format `event: <type>\ndata: <json>\n\n`.

| Event | When | Data fields |
|-------|------|-------------|
| `progress` | Each pipeline step during report generation | `message` (str) — progress description in Spanish (e.g., `"  Consultando Padrón A5 ..."`) |
| `complete` | Pipeline finished or early-return case | `reply` (str), `conversation_id` (str, present in early returns), `data` (dict \| null, present when pipeline succeeded) |

#### Intent support

Only `REPORTE_COMPLETO` intent produces streaming progress events. All other intents (including `TAXPAYER_QUERY`) return a single `complete` event immediately with the same logic as the non-streaming endpoint, wrapped in SSE format.

#### Scenario: Reporte completo with streaming progress

- GIVEN a message like "reporte completo 20324837796"
- WHEN POST /v1/chat/message/stream processes it
- THEN the response MUST be `text/event-stream`
- AND one or more `progress` events MUST be sent, each with a `message` describing the current pipeline step
- AND a final `complete` event MUST be sent with `reply` and `data`
- AND `data` MUST contain the report results (RulesOutput, PadronA5Output, etc.)

#### Scenario: Client disconnects mid-stream

- GIVEN a client that disconnects before the stream completes
- WHEN the server attempts to write to the disconnected response
- THEN the server MUST NOT crash or leave dangling background tasks
- AND the async generator MUST be cancelled cleanly

#### Scenario: Mensaje sin CUIT (streaming)

- GIVEN a message without any valid CUIT pattern
- WHEN POST /v1/chat/message/stream processes it
- THEN a single `complete` event MUST be returned
- AND `reply` MUST prompt the user to provide a CUIT

#### Scenario: Intento no soportado (streaming)

- GIVEN a message with a supported intent other than `REPORTE_COMPLETO` (e.g., a taxpayer query like "consulta datos 20324837796")
- WHEN POST /v1/chat/message/stream processes it
- THEN a single `complete` event MUST be returned
- AND `reply` MUST indicate the intent is not supported for streaming

#### Scenario: Error de backend interno (streaming)

- GIVEN a backend service returns an error during pipeline execution
- WHEN the streaming pipeline catches the exception
- THEN a `complete` event MUST be returned
- AND `reply` MUST include the error description in Spanish

### Requirement: GET /v1/chat/reports/{filename}

The system MUST serve generated PDF reports for download.

#### Request format

| Parameter | Type | Location | Description |
|-----------|------|----------|-------------|
| `filename` | str | Path (may include subdirectory segments via `:path` converter) | PDF filename or relative path |

#### Response format

- Success: `200 OK` with `Content-Type: application/pdf`
- Not found: `404 Not Found` with JSON body `{"detail": "Archivo no encontrado"}`

#### File resolution order

The endpoint MUST search for the file in the following order:
1. **Docker volume**: `/app/output/{filename}` (production path)
2. **Local fallback**: `storage/{filename}` (development path)

#### Path traversal prevention

The endpoint MUST resolve the requested path with `Path.resolve()` and verify that the resolved path starts with the expected base directory. If the resolved path falls outside the allowed directory, the endpoint MUST return `404 Not Found` without accessing the file system.

#### Scenario: File exists in Docker volume

- GIVEN a file at `/app/output/reporte-20324837796.pdf`
- WHEN GET /v1/chat/reports/reporte-20324837796.pdf is requested
- THEN the server MUST return `200 OK`
- AND `Content-Type` MUST be `application/pdf`
- AND the file content MUST be served from the Docker volume path

#### Scenario: Fallback to local storage

- GIVEN a file that does NOT exist in `/app/output/` but exists at `storage/reporte-20324837796.pdf`
- WHEN GET /v1/chat/reports/reporte-20324837796.pdf is requested
- THEN the server MUST return `200 OK`
- AND `Content-Type` MUST be `application/pdf`
- AND the file content MUST be served from the local `storage/` path

#### Scenario: File not found

- GIVEN a filename that does not exist in either `/app/output/` or `storage/`
- WHEN GET /v1/chat/reports/inexistente.pdf is requested
- THEN the server MUST return `404 Not Found`
- AND `detail` MUST be `"Archivo no encontrado"`

#### Scenario: Path traversal attempt

- GIVEN a filename like `../../etc/passwd`
- WHEN GET /v1/chat/reports/../../etc/passwd is requested
- THEN the server MUST return `404 Not Found`
- AND the file system outside the allowed directories MUST NOT be accessed

### Requirement: POST /v1/chat/wizard

The system MUST provide a `POST /v1/chat/wizard` endpoint that implements a multi-turn state machine for the guided onboarding wizard. This endpoint MUST NOT modify the behavior of `POST /v1/chat/message` or `POST /v1/chat/message/stream`.

#### Request format

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `cuit` | `str \| null` | No | CUIT ingresado por el usuario (11 dígitos) |
| `tasks` | `{ deuda: bool, facilidades: bool, registro: bool, iibb: bool } \| null` | No | Tareas seleccionadas |
| `conversation_id` | `str \| null` | No | Identificador de conversación (se genera si se omite) |

#### State machine

The endpoint SHALL maintain wizard state per conversation:

| Request | From | To | Behavior |
|---------|------|----|----------|
| `cuit: null` | — | `awaiting_cuit` | Pide CUIT |
| `cuit` valido | `awaiting_cuit` | `awaiting_tasks` | Auto-descubre cliente via `_completar_cliente_desde_padron` |
| `cuit + tasks` | `awaiting_tasks` | `processing` | Ejecuta pipeline con flags dinámicos via SSE |
| — | `processing` | `complete` | Resultado + link al PDF |

#### Response format (non-streaming states)

The response MUST contain:
- `conversation_id` (str): Identificador de conversación
- `state` (str): Estado actual (`awaiting_cuit`, `awaiting_tasks`, `processing`, `complete`)
- `reply` (str): Respuesta en español para el usuario
- `data` (dict \| null): Datos estructurados (cliente descubierto en `awaiting_tasks`, resultado en `complete`)

#### Processing state (SSE)

When state transitions to `processing`, the endpoint MUST return `text/event-stream` with the same SSE format as `POST /v1/chat/message/stream`:
- `event: progress` — cada paso del pipeline
- `event: complete` — resultado final con `reply`, `conversation_id`, y `data` (incluye `pdf_url`)

#### State persistence

Wizard state MUST be persisted in Redis under `tenant:{tenant_id}:wizard:{conversation_id}` with a TTL of 1 hour. Expired state MUST reset to `awaiting_cuit`.

#### Reuse of existing logic

The endpoint MUST reuse `_procesar_cliente_pipeline()` and `PipelineService.run_pipeline()` without modification. Task flags (`with_deuda`, `with_facilidades`, `with_registro`, `with_iibb`) MUST be set dynamically based on the `tasks` field from the request, NOT hardcoded. The endpoint MUST reuse `_completar_cliente_desde_padron()` for auto-discovery in the `awaiting_tasks` state.

#### Scenario: Flujo completo del wizard

- GIVEN a conversation with no prior wizard state
- WHEN the client sends `POST /v1/chat/wizard` with `{"cuit": null}`
- THEN the response MUST have `state: "awaiting_cuit"` and `reply` must ask for a CUIT
- WHEN the client sends `POST /v1/chat/wizard` with `{"cuit": "20324837796", "conversation_id": "<id>"}`
- THEN the response MUST have `state: "awaiting_tasks"` and `data` MUST include the discovered client info
- WHEN the client sends `POST /v1/chat/wizard` with `{"cuit": "20324837796", "tasks": {"deuda": true, "facilidades": true, "registro": false, "iibb": false}, "conversation_id": "<id>"}`
- THEN the response MUST be SSE with `progress` events for each pipeline step and a final `complete` event
- AND `data` in the `complete` event MUST include `pdf_url` pointing to the generated report

#### Scenario: CUIT inválido

- GIVEN a conversation in `awaiting_cuit` state
- WHEN the client sends a `cuit` that is not 11 digits
- THEN the response MUST return `state: "awaiting_cuit"` and `reply` must indicate the CUIT is invalid

#### Scenario: Cliente no descubierto

- GIVEN a valid CUIT that does not exist in ARCA padrón
- WHEN `_completar_cliente_desde_padron` fails
- THEN the response MUST return `state: "awaiting_cuit"` and `reply` must ask the user to verify the CUIT

#### Scenario: Estado expirado

- GIVEN a conversation whose wizard state expired in Redis
- WHEN the client sends a request with the expired `conversation_id`
- THEN the server MUST treat it as a new conversation with `state: "awaiting_cuit"`

#### Scenario: Endpoints existentes no modificados

- GIVEN the existing `POST /v1/chat/message` and `POST /v1/chat/message/stream` endpoints
- WHEN requests are sent to those endpoints
- THEN they MUST behave exactly as before the wizard change, with no difference in request/response format or routing logic
