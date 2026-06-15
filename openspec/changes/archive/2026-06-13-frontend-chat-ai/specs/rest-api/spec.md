# Delta for: REST API

## ADDED Requirements

### Requirement 11: POST /v1/chat/message

The system MUST accept natural-language fiscal queries and return structured chat replies. Uses `ChatResponse` (proprietary envelope) instead of `UnifiedResponse` — the chat response shape (`reply`, `actions_taken`, `data`) does not fit the generic envelope.

#### Scenario: Happy path — consulta CUIT

- GIVEN a message like "consulta datos del contribuyente 20-32483779-6"
- WHEN POST /v1/chat/message processes it
- THEN `actions_taken` MUST contain `"consultar_cuit"`
- AND `data` MUST contain PadronA5Output fields (nombre, tipo, domicilio)

#### Scenario: Happy path — consulta deuda

- GIVEN a message like "deuda de 20324837796"
- WHEN POST /v1/chat/message processes it
- THEN `actions_taken` MUST contain `"consultar_deuda"`
- AND `reply` MUST include the total debt amount in natural language

#### Scenario: Mensaje sin CUIT

- GIVEN a message without any valid CUIT pattern
- WHEN POST /v1/chat/message processes it
- THEN `reply` MUST prompt the user to provide a CUIT
- AND `actions_taken` MUST be an empty list
