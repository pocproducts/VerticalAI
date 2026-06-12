# Idempotency Specification

## Purpose

Define el contrato base para operaciones idempotentes del sistema. Esta fase establece únicamente el schema — la implementación de almacenamiento y deduplicación está planificada para una fase posterior.

## Requirements

### Requirement: IdempotentRequest base mixin

The system MUST provide an `IdempotentRequest` Pydantic v2 base model or mixin with field `idempotency_key: Optional[str] = None`.

#### Scenario: Request without idempotency key

- GIVEN a write operation that does not require idempotency guarantees
- WHEN constructing a request without `idempotency_key`
- THEN `idempotency_key` MUST be `None`
- AND the operation MUST proceed normally

#### Scenario: Request with idempotency key

- GIVEN a write operation that should be idempotent
- WHEN constructing a request with `idempotency_key="550e8400-e29b-41d4-a716-446655440000"`
- THEN `idempotency_key` MUST be a non-`None` string
- AND the field MUST be present on the request

### Requirement: Idempotency key format

`idempotency_key` SHOULD be a UUID v4 string.

#### Scenario: Non-UUID key is accepted

- GIVEN an `idempotency_key` that is not a valid UUID v4
- WHEN constructing the request
- THEN the model MUST still accept the string (no format validation at schema level)

### Requirement: Write operations SHOULD accept idempotency_key

Every write operation in the system SHOULD accept an optional `idempotency_key` field, typically by inheriting from `IdempotentRequest`.

#### Scenario: Inheriting IdempotentRequest

- GIVEN a write request model
- WHEN it inherits from `IdempotentRequest`
- THEN `idempotency_key` MUST be present as an inherited field

### Requirement: No storage or deduplication yet

The system MUST NOT implement idempotency key storage, deduplication, or response caching in this phase. Only the schema contract is in scope.

#### Scenario: Schema-only contract

- GIVEN a request with an `idempotency_key`
- WHEN processing the operation
- THEN no lookup, storage, or cache logic SHALL be executed
- AND the key MUST pass through without side effects

### Requirement: Documentation of deferred implementation

The field documentation for `idempotency_key` SHOULD indicate that idempotency implementation is planned for a later phase.

#### Scenario: Docstring communicates deferral

- GIVEN the `idempotency_key` field definition
- WHEN reading its docstring or description
- THEN it SHOULD include language like "Idempotency implementation is planned for a later phase"
