# Delta for chat-backend — Wizard Multi-turn

## ADDED Requirements

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
- `data` (dict | null): Datos estructurados (cliente descubierto en `awaiting_tasks`, resultado en `complete`)

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

## MODIFIED Requirements

None — no existing endpoint is modified.

## REMOVED Requirements

None.
