# Design: Fase 0 — Foundation

## Technical Approach

Agregar ~8 nuevos modelos Pydantic v2 genéricos a `fiscal_agent/models.py` sin modificar ningún modelo existente. Los nuevos modelos envuelven a los existentes mediante `UnifiedResponse[T]` genérico. Sin cambios en infraestructura, sin servidor, sin lógica de negocio.

## Architecture Decisions

### Decision: UnifiedResponse[T] como Generic Pydantic model

**Choice**: `UnifiedResponse[T]` con `Generic[T]` de typing, usando `model_serializer` para type safety.
**Alternatives considered**: (a) Union type manual por cada operación (b) `Any` como type erasure
**Rationale**: Pydantic v2 soporta `Generic[T]` nativamente. Mantiene type safety sin modificar modelos existentes.

### Decision: Todos los modelos en models.py

**Choice**: Agregar los ~8 modelos nuevos al mismo `fiscal_agent/models.py`
**Alternatives considered**: (a) `api_models.py` separado (b) `identity_models.py` separado
**Rationale**: Sigue el patrón existente del proyecto. Solo son modelos de datos, sin lógica. Separar ahora añadiría complejidad innecesaria. Se puede refactorizar más adelante si el archivo crece demasiado.

### Decision: Scope como StrEnum

**Choice**: `class Scope(str, Enum)` para compatibilidad máxima con Pydantic v2
**Alternatives considered**: `StrEnum` de Python 3.11+ (disponible pero menos testeado con Pydantic)
**Rationale**: `str, Enum` es el patrón probado en el proyecto (ver `TipoContribuyente`, `TipoPersona` existentes)

## Data Flow

```
Request (sin servidor aún)
    │
    ▼
UnifiedResponse[T] wraps result:
    ├── status: "success" | "error" | "pending" | "requires_approval"
    ├── result: T (cualquier modelo existente)
    ├── next_actions: list[str]
    ├── human_approval_required: bool
    └── error: ApiError | None
            ├── code: str
            ├── cause: str
            └── remediation: str (opcional)
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `fiscal_agent/models.py` | Modify | Agregar UnifiedResponse, ApiError, IdempotentRequest, Developer, App, ApiKey, Plan, Scope |
| `fiscal_agent/__init__.py` | Modify | Exportar los ~8 nuevos modelos |

## Interfaces / Contracts

```python
# Output Schema
class UnifiedResponse(BaseModel, Generic[T]):
    status: Literal["success", "error", "pending", "requires_approval"]
    result: T | None = None
    next_actions: list[str] = []
    human_approval_required: bool = False
    error: ApiError | None = None

class ApiError(BaseModel):
    code: str
    cause: str
    remediation: str = ""

# Idempotency
class IdempotentRequest(BaseModel):
    idempotency_key: str | None = None

# Tenant / Identity
class Scope(str, Enum): ...
class Developer(BaseModel): ...
class App(BaseModel): ...
class ApiKey(BaseModel): ...
class Plan(BaseModel): ...
```

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | UnifiedResponse type safety | Crear instancia con distintos tipos T, verificar serialización |
| Unit | Scope enum values | Verificar que los valores sean strings consistentes |
| Unit | Model defaults | Verificar que ApiError.remediation default sea "" vacío |

## Migration / Rollout

No migration required. Solo se agregan modelos nuevos. Cero impacto en código existente.

## Open Questions

None.
