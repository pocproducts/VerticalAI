# Design: Chat UI Wizard

## Technical Approach

Replicar el wizard del CLI en la UI del chat mediante un nuevo endpoint SSE `POST /v1/chat/wizard` con estado multi-turno en Redis, y un componente `WizardOnboarding` que reemplaza el empty state del `ChatPane`. Los endpoints existentes no se tocan. `useChat.js` no se modifica — el wizard maneja su propio fetch.

## Architecture Decisions

| Option | Tradeoff | Decision |
|--------|----------|----------|
| Endpoint único vs multi-endpoint | Multi-endpoint es más RESTful pero fuerza al frontend a trackear la URL. Único con estado en Redis mantiene al frontend simple. | **Único**: `POST /v1/chat/wizard` con SSE |
| Estado en Redis vs in-memory | Redis sobrevive crashes, ya disponible en el codebase (`RedisStore`), TTL nativo. In-memory es más simple pero se pierde al reiniciar. | **Redis** — clave `tenant:{tid}:wizard:{cid}` con TTL 3600s |
| Modificar `useChat` vs estado local en `WizardOnboarding` | Modificar `useChat` es mantenible a largo plazo pero riesgo de romper el flujo existente. Estado local aísla el cambio. | **Estado local en WizardOnboarding** — llama `fetch` directo |
| SSE vs polling | SSE ya es el patrón establecido en el codebase para streaming de pipeline (`chat_message_stream`). Polling agrega latencia. | **SSE** — reusa el patrón `asyncio.Queue` + `call_soon_threadsafe` |

## Data Flow

```
WizardOnboarding                   POST /v1/chat/wizard              chat.py
┌──────────────┐    fetch(SSE)    ┌──────────────────┐   Redis    ┌─────────────┐
│ Step: CUIT   │ ───────────────→ │ wizard_state()    │ ←──────→ │ RedisStore  │
│ Step: Tasks  │ ←─── SSE events  │  • read state      │           └─────────────┘
│ Step: Progres│                  │  • update state    │           PipelineService
└──────────────┘                  │  • run pipeline    │ ────────→ run_pipeline()
                                  │  • stream progress │           (with flags)
                                  └──────────────────┘
```

### Wizard State Machine

```
null ──→ awaiting_cuit ──→ awaiting_tasks ──→ processing ──→ complete
              │                   │
              └── (re-submit) ────┘               (new CUIT → reset)
```

## API Contract

### `POST /v1/chat/wizard`

Request (application/json):
```json
{
  "cuit": "30716395541",
  "tasks": { "deuda": true, "facilidades": true, "registro": true, "iibb": false },
  "conversation_id": "abc123"
}
```

- Primer llamado: `{ "cuit": null, "tasks": null, "conversation_id": null }`
- Segundo: `{ "cuit": "30716395541", "tasks": null, "conversation_id": "abc123" }`
- Tercero: `{ "cuit": "30716395541", "tasks": {...}, "conversation_id": "abc123" }`

Response: SSE stream with events:

```
event: wizard_state
data: {"state":"awaiting_cuit","reply":"Ingresá el CUIT del contribuyente","conversation_id":"abc123"}

event: wizard_state
data: {"state":"awaiting_tasks","reply":"Seleccioná las tareas a ejecutar","cliente":{"nombre":"...","tipo":"..."},"conversation_id":"abc123"}

event: progress
data: {"message":"  Consultando Padrón A5 ..."}

event: progress
data: {"message":"  Generando PDF ..."}

event: complete
data: {"state":"complete","reply":"Reporte generado","data":{...},"pdf_url":"/v1/chat/reports/...","conversation_id":"abc123"}
```

State machine on backend:

1. `cuit is None` → create conv_id, save `{state: awaiting_cuit}`, yield `wizard_state`
2. `cuit set, tasks is None` → save `{state: awaiting_tasks, cuit}`, run `_completar_cliente_desde_padron()`, yield `wizard_state` with `cliente` data
3. `cuit + tasks set` → save `{state: processing}`, run pipeline in thread pool via `_procesar_cliente_pipeline()` with selected flags, stream progress events, yield `complete`
4. Any error → yield `wizard_state: {state: "error", reply: "..."}`

## Component Architecture

```
ChatPane.jsx
├── WizardOnboarding.jsx          ← NEW — renders when messages.length === 0
│   ├── WizardStepCuit.jsx        ← NEW — CUIT input + validation
│   ├── WizardStepTasks.jsx       ← NEW — checkboxes for deuda/facilidades/registro/iibb
│   ├── ProgressMessage.jsx       ← REUSED — from existing component
│   └── WizardResult.jsx          ← NEW — resultado + PDF link
├── Message.jsx                   ← existing
├── Composer.jsx                  ← existing — unchanged
└── ProgressMessage.jsx           ← existing — reused for non-wizard /stream
```

### WizardOnboarding State (local, no useChat)

```javascript
// WizardOnboarding.jsx — owns its own state
const [step, setStep] = useState("cuit")           // cuit | tasks | processing | complete
const [cuit, setCuit] = useState("")
const [tasks, setTasks] = useState(allTrue)
const [conversationId, setConversationId] = useState(null)
const [progressSteps, setProgressSteps] = useState([])
const [result, setResult] = useState(null)
const [clienteInfo, setClienteInfo] = useState(null)
```

No modifica `useChat.js`. Cuando el wizard completa, agrega un mensaje `{ role: "assistant", content: reply }` a la conversación vía `onWizardComplete` callback.

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `fiscal_agent/api/routes/chat.py` | Modify | Agregar `POST /v1/chat/wizard` endpoint + Pydantic models + SSE generator |
| `frontend/.../components/WizardOnboarding.jsx` | Create | Componente wizard: CUIT → tasks → progreso → resultado |
| `frontend/.../components/WizardStepCuit.jsx` | Create | Step: input CUIT con validación 11 dígitos |
| `frontend/.../components/WizardStepTasks.jsx` | Create | Step: checkboxes tareas con defaults activos |
| `frontend/.../components/WizardResult.jsx` | Create | Step: resultado + link PDF |
| `frontend/.../components/ChatPane.jsx` | Modify | Render `WizardOnboarding` cuando `messages.length === 0` |
| `frontend/.../lib/api-client.js` | Modify | Agregar `sendWizard()` método SSE |
| `frontend/.../hooks/useChat.js` | Modify (minimal) | Solo agregar callback `onWizardComplete` para insertar resultado como mensaje |

## Interfaces / Contracts

### Backend (Pydantic)

```python
class WizardRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    cuit: str | None = Field(default=None, description='CUIT del contribuyente')
    tasks: WizardTasks | None = Field(default=None, description='Tareas seleccionadas')
    conversation_id: str | None = Field(default=None)

class WizardTasks(BaseModel):
    model_config = ConfigDict(extra='forbid')
    deuda: bool = Field(default=True)
    facilidades: bool = Field(default=True)
    registro: bool = Field(default=True)
    iibb: bool = Field(default=False)  # default off — requiere provincia
```

### Frontend (api-client.js)

```javascript
apiClient.sendWizard(token, { cuit, tasks, conversationId }, { onState, onProgress })
// Returns { promise, abort }
```

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | Wizard request validation | Pydantic model tests (e.g. CUIT validation, task defaults) |
| Integration | Wizard SSE endpoint | httpx SSE client — test state transitions: null→awaiting_cuit, cuit→awaiting_tasks, full→processing→complete |
| Integration | Pipeline with subset of flags | Verify `_procesar_cliente_pipeline` called with correct `with_*` flags |
| E2E | Full wizard flow | Simulate 3 requests and verify SSE event sequence |
| E2E | Wizard + existing endpoints | Verify `/v1/chat/message` and `/stream` still work unchanged |

## Migration / Rollout

No migration required. New endpoint + new component coexists with existing code. Wizard only renders when there are zero messages — existing conversations see no change.

## Open Questions

- [ ] ¿Usar Redis directamente (`app.state.redis`) o agregar método a `RedisStore`? Recomiendo Redis directo con key `wizard:{cid}` para mantener separado del CRUD de conversaciones.
- [ ] `send_email` en pipeline — el proposal dice mantener `False` como hoy. ¿El wizard permite toggle? Decisión: no, siempre `False` (el envío de email es feature separado).
