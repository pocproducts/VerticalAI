# Design: Frontend Chat AI

## Technical Approach

```
Browser ──→ Next.js Rewrite ──→ POST /v1/chat/message
                                    │
                              IntentRouter.detect(text)
                                    │
                         ┌──────────┼──────────┐
                         │          │          │
                   taxpayer    deuda      calendario ...
                         │          │          │
                    (reuse internal functions — consultar_cuit(),
                     engine.get_vencimientos(), browser.deuda, etc.)
                         │          │          │
                         └──────────┼──────────┘
                                    │
                              ResponseBuilder.format(data)
                                    │
                              {reply, actions_taken, data}
```

Sin LLM — todo regex-based intent routing + reuso de lógica existente de `fiscal_agent/api/routes/`. El frontend envía todo a un solo endpoint; el backend decide qué hacer.

---

## Architecture Decisions

| # | Decisión | Alternativas | Rationale |
|---|----------|-------------|-----------|
| 1 | **Intent routing en backend** | Frontend routing (keyword matching en JS) | Un solo endpoint permite que CLI, MCP server y otros frontends consuman la misma lógica. El frontend actual ya tiene routing hardcodeado en `AIAssistantUI.sendMessage` — lo sacamos del cliente. |
| 2 | **Regex matching (fase 1)** | NLP / LLM / ML | Las queries fiscales son estructuradas: siempre incluyen CUIT + verbo conocido. Regex es determinista, cero latencia de inferencia, sin dependencias externas. Migrar a NLP si los patrones se vuelven demasiado complejos. |
| 3 | **Síncrono (fase 1)** | SSE streaming | El response builder genera texto corto (<1KB). Streaming agrega complejidad innecesaria. SSE se agrega como mejora futura si se necesita mostrar progreso de pipeline. |
| 4 | **Next.js rewrites como proxy** | CORS directo, API route de Next.js | Rewrites del lado servidor ocultan la API key del bundle JS del browser y evitan configurar CORS en el backend. Patrón estándar de Next.js. |
| 5 | **LocalStorage (fase 1)** | Backend persistence (Redis) | Sin sesiones de usuario ni auth, no hay un tenant key para asociar conversaciones. LocalStorage es suficiente para persistencia entre recargas. Migrar a backend cuando haya auth. |
| 6 | **Formato propio de respuesta** | UnifiedResponse | El chat necesita `reply` (texto natural) + `actions_taken` (lista de acciones), que no encajan en `UnifiedResponse.result`. Usamos `ChatResponse` propio para no contaminar el envelope genérico. |

---

## Component Design

### IntentRouter (`fiscal_agent/chat/intent_router.py`)

```
CUITS: re.compile(r'\b(?:20|23|24|27|30|33|34)\d{9}\b')

Intents: TAXPAYER_QUERY | DEUDA_QUERY | FACILIDADES_QUERY
         | REGISTRO_QUERY | CALENDARIO_QUERY | REPORTE_COMPLETO | UNKNOWN

detect(text) → (cuit: str|None, intent: Intent, params: dict)
```

- CUIT se extrae primero con `CUIT_REGEX.findall()`.
- Intención se detecta con keywords por intent:
  - TAXPAYER: `consulta|datos|padron|contribuyente`
  - DEUDA: `deuda|saldo|adeuda|adeudado`
  - FACILIDADES: `facilidades|plan|cuotas|pago`
  - CALENDARIO: `calendario|vencimientos|vto` + intenta parsear mes/año
  - REGISTRO: `registro|impuestos|actividades|domicilio`
  - REPORTE: `reporte|completo|resumen|pipeline`
- Sin CUIT → reply pide CUIT. Sin intent matching → lista tipos soportados.

### ResponseBuilder (`fiscal_agent/chat/response_builder.py`)

```
format(intent, data, error=None) → ChatResponse
```

Toma `data` de cada handler (`PadronA5Output`, `DeudaOutput`, `RulesOutput`, etc.) y genera:
- **reply**: texto en español natural (formatea montos con separador de miles, fechas en locale AR)
- **actions_taken**: `["consultar_cuit"]`, `["consultar_deuda"]`, etc.
- **data**: structured payload crudo para debugging o rich UI

### ChatHandler (`fiscal_agent/api/routes/chat.py`)

```
POST /v1/chat/message
  Body: {message: str, conversation_id?: str, history?: list}
  Auth: ScopeRequired (scope: taxpayer:read + calendar:read + report:read)
  
  Flow:
    1. Parse body → ChatRequest
    2. cuit, intent, params = IntentRouter.detect(message)
    3. if not cuit: reply "por favor proporcioná un CUIT"
    4. if intent == UNKNOWN: reply listando tipos soportados
    5. Dispatch a handler interno (reusa funciones de arca_ws, engine, browser)
    6. result = ResponseBuilder.format(intent, data)  
    7. Return ChatResponse(conversation_id, reply, actions_taken, data)
```

Los handlers internos NO llaman a los endpoints HTTP — reusan las funciones internas directamente (`consultar_cuit()`, `engine.get_vencimientos()`, `ComposioBrowser` para deuda/facilidades/registro). Esto evita overhead HTTP intra-servicio.

### api-client.js (`lib/api-client.js`)

```js
const apiClient = {
  async sendMessage(message, conversationId = null, history = []) {
    const url = `${process.env.NEXT_PUBLIC_API_URL}/v1/chat/message`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.NEXT_PUBLIC_API_KEY}`,
      },
      body: JSON.stringify({ message, conversation_id: conversationId, history }),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new ApiError(res.status, await res.text());
    return res.json(); // {conversation_id, reply, actions_taken, data}
  },
};
```

### useChat hook (`hooks/useChat.js`)

```
State: messages[], loading, error, conversationId, conversations[]
Methods:
  - sendMessage(text): llama apiClient.sendMessage, actualiza messages
  - loadHistory(): restore desde LocalStorage
  - newConversation(): crea nueva con ID único

Auto-guarda messages a LocalStorage tras cada exchange.
Carga la última conversación activa al init.
```

---

## Data Flow

### 1. Consulta CUIT exitosa

```
User ──→ AIAssistantUI.sendMessage("consulta CUIT 20-32483779-6")
         │
         ├── useChat.sendMessage("consulta CUIT 20-32483779-6")
         │   ├── messages += userMsg
         │   ├── loading = true
         │   └── apiClient.sendMessage(message, convId)
         │       └── Next.js rewrite → POST /v1/chat/message
         │
         ├── ChatHandler:
         │   ├── IntentRouter.detect("consulta CUIT 20-32483779-6")
         │   │   ├── CUIT_REGEX → ["20324837796"]
         │   │   └── keywords → TAXPAYER_QUERY
         │   ├── dispatch: taxpayer_handler("20324837796")
         │   │   ├── get_ta() → token, sign
         │   │   ├── consultar_cuit(cuit, token, sign, representante)
         │   │   └── → PadronA5Output con datosGenerales + domicilio
         │   └── ResponseBuilder.format(TAXPAYER_QUERY, padron_data)
         │       → reply: "Contribuyente: Juan Pérez\nCUIT: 20-32483779-6\nDomicilio: ..."
         │       → actions_taken: ["consultar_cuit"]
         │
         └── Response → useChat
             ├── messages += assistantMsg
             ├── loading = false
             └── localStorage.save(conversations)
```

### 2. CUIT no encontrado (error handling)

```
ChatHandler:
  ├── IntentRouter.detect → TAXPAYER_QUERY, cuit="20324837796"
  ├── taxpayer_handler:
  │   ├── consultar_cuit() → PadronA5Output con errorConstancia
  │   └── error: ["CUIT INACTIVO", "CLAVE NO EXISTE"]
  └── ResponseBuilder.format(TAXPAYER_QUERY, data, error=...)
      → reply: "No se encontraron datos para el CUIT 20-32483779-6. Motivo: CUIT INACTIVO. Verificá el número e intentá de nuevo."
      → actions_taken: ["consultar_cuit"]
      → data: {errorConstancia: {error: ["CUIT INACTIVO"]}}
```

### 3. Frontend → Backend via Next.js Rewrite

```
Browser JS fetch("/api/v1/chat/message", {...})
         │
         └── Next.js Server (server-side)
             ├── next.config.mjs rewrite:
             │   source: "/api/:path*"
             │   destination: "http://fiscal-agent:8000/:path*"
             │
             ├── Agrega header Authorization (API key desde env del server)
             │
             └── HTTP → fiscal-agent:8000/v1/chat/message
                         │
                         └── ChatHandler → IntentRouter → handler → ResponseBuilder
```

---

## File Structure

```
fiscal_agent/chat/
├── __init__.py               # Exporta detect_intent, format_response
├── intent_router.py          # CUIT_REGEX, intent_map, detect(text) → (cuit, intent, params)
└── response_builder.py       # format(intent, data, error) → ChatResponse

fiscal_agent/api/routes/
└── chat.py                   # POST /v1/chat/message — ChatHandler

fiscal_agent/api/server.py    # MODIFIED: app.include_router(chat.router, tags=['chat'])

frontend/IdeaDashboardai-chatbot-interface-template/
├── lib/
│   └── api-client.js         # NEW: fetch wrapper con auth + timeout
├── hooks/
│   └── useChat.js            # NEW: estado + API + LocalStorage persistence
├── components/
│   ├── AIAssistantUI.jsx     # MODIFIED: reemplazar setTimeout mock por useChat
│   └── mockData.js           # MODIFIED: INITIAL_CONVERSATIONS pasa a [] (useChat los carga de LS)
├── next.config.mjs           # MODIFIED: agregar rewrites para /api/* → backend
└── .env.local                # NEW: NEXT_PUBLIC_API_URL, NEXT_PUBLIC_API_KEY

docker-compose.yml            # MODIFIED: frontend service (puerto 3000, depends_on: fiscal-agent)
```

---

## Interfaces / Contracts

```python
# fiscal_agent/api/routes/chat.py

class ChatRequest(BaseModel):
    message: str
    conversation_id: str | None = None
    history: list[dict] | None = None  # [{"role": "user"|"assistant", "content": str}]

class ChatResponse(BaseModel):
    conversation_id: str
    reply: str
    actions_taken: list[str]
    data: dict | None = None
```

```js
// lib/api-client.js — response shape
{
  conversation_id: "abc123",
  reply: "Contribuyente: ...",
  actions_taken: ["consultar_cuit"],
  data: { /* PadronA5Output fields */ }
}
```

---

## Testing Strategy

| Layer | What | How |
|-------|------|-----|
| Unit | `IntentRouter.detect()` — cada combinación CUIT + intent + edge cases | Parametrize con pytest, test sin red |
| Unit | `ResponseBuilder.format()` — cada tipo de output + error | Test con fixtures de modelos Pydantic |
| Integration | `POST /v1/chat/message` con mock de handlers | FastAPI TestClient + monkeypatch de funciones internas |
| Unit | `api-client.js` — timeout, error, happy path | Mock de fetch |
| Unit | `useChat` — send, error, localStorage restore | Vitest + mock de localStorage |

---

## Migration / Rollout

1. Crear `fiscal_agent/chat/` + `chat.py` primero — endpoint sin frontend
2. Verificar con curl: `POST /v1/chat/message {"message": "consulta CUIT 20324837796"}`
3. Agregar frontend: api-client → useChat → modificar AIAssistantUI
4. Agregar `docker-compose.yml` frontend service + `next.config.mjs` rewrites
5. Rollback: eliminar archivos nuevos, revertir modificaciones

---

## Open Questions

- [ ] ¿Qué scope requiere POST /v1/chat/message? Necesita taxpayer:read, calendar:read, report:read — ¿scope compuesto o validación manual por handler interno?
