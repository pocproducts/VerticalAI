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
