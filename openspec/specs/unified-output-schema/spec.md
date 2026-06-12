# Unified Output Schema Specification

## Purpose

Define un contrato de respuesta uniforme para todas las operaciones del sistema. `UnifiedResponse[T]` envuelve cualquier tipo de dominio existente (`DeudaOutput`, `RulesOutput`, etc.) en un envelope consistente con status, resultado, errores estructurados y metadatos para el agente.

## Requirements

### Requirement: UnifiedResponse[T] generic wrapper

The system MUST provide a generic Pydantic v2 model `UnifiedResponse[T]` that wraps any domain payload.

#### Scenario: Wrap a domain payload in UnifiedResponse

- GIVEN a domain type `DeudaOutput` with valid data
- WHEN constructing `UnifiedResponse[DeudaOutput]`
- THEN the instance MUST be type-safe and carry the payload in `result`

#### Scenario: Wrap a different domain type

- GIVEN a domain type `RulesOutput` with valid data
- WHEN constructing `UnifiedResponse[RulesOutput]`
- THEN `result` MUST be typed as `RulesOutput`

### Requirement: Status field

`UnifiedResponse.status` MUST be a string constrained to: `"success" | "error" | "pending" | "requires_approval"`.

#### Scenario: Success status

- GIVEN an operation that completed without errors
- WHEN constructing the response
- THEN `status` MUST be `"success"`

#### Scenario: Error status

- GIVEN an operation that failed
- WHEN constructing the response
- THEN `status` MUST be `"error"`

#### Scenario: Pending status

- GIVEN an asynchronous or deferred operation
- WHEN constructing the response
- THEN `status` MUST be `"pending"`

#### Scenario: Requires approval status

- GIVEN an operation that needs human intervention before proceeding
- WHEN constructing the response
- THEN `status` MUST be `"requires_approval"`

### Requirement: Result field

`UnifiedResponse.result` SHOULD contain the typed domain payload `T`.

#### Scenario: Result absent on error

- GIVEN a response with status `"error"`
- WHEN inspecting `result`
- THEN `result` SHOULD be `None`

### Requirement: Next actions

`UnifiedResponse.next_actions` SHOULD be an optional list of strings suggesting next steps for the agent.

#### Scenario: Suggested next steps

- GIVEN a completed operation
- WHEN the response includes `next_actions`
- THEN each entry MUST be a human-readable string like `"review_pdf"` or `"notify_client"`

### Requirement: Human approval flag

`UnifiedResponse.human_approval_required` MUST be a boolean field defaulting to `False`.

#### Scenario: Operation requiring approval

- GIVEN an operation flagged for human review
- WHEN constructing the response
- THEN `human_approval_required` MUST be `True`

### Requirement: ApiError structure

`UnifiedResponse.error` SHOULD be `ApiError | None`. `ApiError` MUST contain `code` (string), `cause` (string), and MAY contain `remediation` (optional string).

#### Scenario: Successful response has no error

- GIVEN a response with status `"success"`
- WHEN inspecting `error`
- THEN `error` MUST be `None`

#### Scenario: Error response with remediation

- GIVEN a failed operation with a known recovery path
- WHEN constructing `ApiError`
- THEN `code` MUST be a machine-readable string like `"ARCA_TIMEOUT"`
- AND `cause` MUST describe the failure
- AND `remediation` MAY suggest a fix like `"Retry with increased timeout"`

### Requirement: Existing models must remain unchanged

The existing domain models (`DeudaOutput`, `RulesOutput`, `PadronA5Output`, etc.) MUST NOT be modified. `UnifiedResponse` wraps them without altering their structure.

#### Scenario: Existing model unchanged after wrapping

- GIVEN an existing `RulesOutput` instance
- WHEN wrapping it in `UnifiedResponse[RulesOutput]`
- THEN the original `RulesOutput` schema MUST be unmodified
