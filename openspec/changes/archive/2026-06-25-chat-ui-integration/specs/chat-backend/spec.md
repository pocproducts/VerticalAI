# Delta for chat-backend

## MODIFIED Requirements

### Requirement: POST /v1/chat/message

The system MUST accept chat messages and return structured replies.

#### Request format

The request body MUST contain:
- `message` (str, required): Natural language query from the user
- `conversation_id` (str | null, optional): Opaque identifier for conversation continuation. The server MUST generate one if omitted.
- `history` (list[dict] | null, optional): Previous messages. Each entry MUST have `role` ("user" | "assistant") and `content` (str). When provided, the server MUST prepend these to the pipeline message list as multi-turn context before intent routing.

#### Response format

The response MUST contain:
- `conversation_id` (str): Echoed or newly-generated conversation identifier. The server MUST scope this per `tenant_id` from auth middleware.
- `reply` (str): Human-readable response text in Spanish
- `actions_taken` (list[str]): Internal actions performed (e.g., `["consultar_cuit"]`)
- `data` (dict | null): Structured results from backend queries (PadronA5Output, DeudaOutput, RulesOutput, etc.)

#### Intent routing

The system MUST detect CUIT (11 digits, optionally with hyphens) and intent via regex, then dispatch to internal functions that reuse existing endpoint logic. The `history` array, when provided, MUST be prepended to the pipeline's message list so that earlier turns inform intent routing and response generation.

| Intent | Trigger | Internal Action |
|--------|---------|-----------------|
| taxpayer | consulta / datos / padron / contribuyente + CUIT | consultar_cuit |
| calendar | calendario / vencimientos / vto + CUIT + mes/año | consultar_calendario |
| debt | deuda / saldo + CUIT | consultar_deuda |
| facilidades | facilidades / plan / cuotas + CUIT | consultar_facilidades |
| registro | registro / impuestos / actividades + CUIT | consultar_registro |
| report | reporte / completo / resumen + CUIT | generar_reporte |

#### Auto-persist

After processing each turn (user → assistant), the server MUST append both the user message and the assistant reply to the conversation store via `ConversationStore.append_messages()`. The key MUST include `tenant_id` from auth middleware: `tenant:{tenant_id}:conv:{conversation_id}`.

(Previously: `history` was accepted but not processed; no auto-persist of messages; no tenant scoping.)

#### Scenario: Consulta CUIT with history

- GIVEN a conversation with prior history `[{"role": "assistant", "content": "La deuda total es $15000"}, {"role": "user", "content": "y el calendario?"}]`
- WHEN POST /v1/chat/message processes it
- THEN `actions_taken` MUST contain `"consultar_calendario"` (history disambiguates intent from prior assistant context)
- AND `data` MUST contain RulesOutput

#### Scenario: Messages auto-persisted after turn

- GIVEN a successful chat turn with `conversation_id: "conv_01"`
- WHEN POST /v1/chat/message returns the response
- THEN `ConversationStore.append_messages()` MUST have been called with `tenant_id`, `"conv_01"`, and both the user message and assistant reply
- AND the conversation store key MUST be `tenant:{tenant_id}:conv:conv_01`

#### Scenario: New conversation created with tenant scoping

- GIVEN a POST without `conversation_id`
- WHEN the server generates a new one
- THEN the generated ID MUST be stored under `tenant:{tenant_id}:conv:{generated_id}`

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
- `history` (list[dict] | null, optional): Previous messages. When provided, MUST be prepended as multi-turn context.

#### Response format

The endpoint MUST return `text/event-stream` with the following headers:
- `Cache-Control: no-cache`
- `Connection: keep-alive`
- `X-Accel-Buffering: no`

Each SSE event follows the format `event: <type>\ndata: <json>\n\n`.

| Event | When | Data fields |
|-------|------|-------------|
| `conversation_start` | First event, before any processing | `conversation_id` (str) |
| `progress` | Each pipeline step during report generation | `message` (str) — progress description in Spanish (e.g., `"  Consultando Padrón A5 ..."`) |
| `complete` | Pipeline finished or early-return case | `reply` (str), `conversation_id` (str, present in early returns), `data` (dict \| null, present when pipeline succeeded) |

The `conversation_start` event MUST be emitted before any `progress` or `complete` events. Its `conversation_id` MUST be scoped per `tenant_id` from auth middleware.

#### Intent support

Only `REPORTE_COMPLETO` intent produces streaming progress events. All other intents (including `TAXPAYER_QUERY`) return a single `conversation_start` followed by a `complete` event immediately, wrapped in SSE format.

#### Auto-persist

When the `complete` event is emitted (after successful pipeline execution), the server MUST append both the user message and the assistant reply via `ConversationStore.append_messages()` before sending the event. The key MUST include `tenant_id`: `tenant:{tenant_id}:conv:{conversation_id}`.

(Previously: no `conversation_start` event; `history` accepted but not processed; no auto-persist; no tenant scoping.)

#### Scenario: conversation_start emitted first

- GIVEN a message "reporte completo 20324837796"
- WHEN POST /v1/chat/message/stream processes it
- THEN the first SSE event MUST be `event: conversation_start` with `data` containing `conversation_id`
- AND subsequent `progress`/`complete` events MUST follow

#### Scenario: Auto-persist on stream complete

- GIVEN a successful streaming response
- WHEN the `complete` event is emitted
- THEN `ConversationStore.append_messages()` MUST have been called before the event
- AND both user message and assistant reply MUST appear in the stored conversation

#### Scenario: History processed in streaming

- GIVEN prior history in the request
- WHEN POST /v1/chat/message/stream processes it
- THEN the history MUST be prepended to the pipeline's message list for context

#### Scenario: Reporte completo with streaming progress

- GIVEN a message like "reporte completo 20324837796"
- WHEN POST /v1/chat/message/stream processes it
- THEN the response MUST be `text/event-stream`
- AND the first event MUST be `conversation_start` with `conversation_id`
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
- THEN a `conversation_start` event MUST be emitted first
- THEN a single `complete` event MUST be returned
- AND `reply` MUST prompt the user to provide a CUIT

#### Scenario: Intento no soportado (streaming)

- GIVEN a message with a supported intent other than `REPORTE_COMPLETO` (e.g., a taxpayer query like "consulta datos 20324837796")
- WHEN POST /v1/chat/message/stream processes it
- THEN a `conversation_start` event MUST be emitted first
- THEN a single `complete` event MUST be returned
- AND `reply` MUST indicate the intent is not supported for streaming

#### Scenario: Error de backend interno (streaming)

- GIVEN a backend service returns an error during pipeline execution
- WHEN the streaming pipeline catches the exception
- THEN a `conversation_start` event MUST be emitted first (if not already sent)
- THEN a `complete` event MUST be returned
- AND `reply` MUST include the error description in Spanish
