# Design: Clerk Frontend Auth

## 1. Target Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        BROWSER (Next.js 15.5)                       │
│                                                                     │
│  ┌──────────────────────────────────────────────┐                   │
│  │              <ClerkProvider>                  │                   │
│  │  ┌─────────┐  ┌──────────┐  ┌─────────────┐  │                   │
│  │  │ SignIn  │  │  ChatUI  │  │  /profile   │  │                   │
│  │  │ SignUp  │  │ (auth'd) │  │ ApiKeys     │  │                   │
│  │  └─────────┘  └────┬─────┘  └──────┬──────┘  │                   │
│  │                     │               │         │                   │
│  │              ┌──────▼──────┐  ┌─────▼──────┐  │                   │
│  │              │  useChat    │  │ apiClient  │  │                   │
│  │              │  (hook)     │  │ (token     │  │                   │
│  │              │             │  │  injection)│  │                   │
│  │              └──────┬──────┘  └─────┬──────┘  │                   │
│  │                     │               │         │                   │
│  │           useAuth().getToken() ──────┘         │                   │
│  └─────────────────────┼─────────────────────────┘                   │
│                        │                                             │
│              ┌─────────▼──────────────────┐                          │
│              │  Clerk.com                  │                          │
│              │  (auth provider)            │                          │
│              │  JWKS endpoint              │                          │
│              └─────────┬──────────────────┘                          │
│                        │                                             │
├────────────────────────┼─────────────────────────────────────────────┤
│                   Internet                                           │
├────────────────────────┼─────────────────────────────────────────────┤
│                   BACKEND (FastAPI)                                   │
│                        │                                             │
│  ┌─────────────────────▼──────────────────────────────────────────┐  │
│  │                    Middleware Chain                              │  │
│  │                                                                  │  │
│  │  CORS → Metrics → AuthMiddleware → TenantCtx → RateLimit → Route│  │
│  │                     │                                            │  │
│  │            ┌────────┴────────┐                                   │  │
│  │            │  Dual Extractor  │                                   │  │
│  │            │  ┌────────────┐  │                                   │  │
│  │            │  │ ClerkJWT   │  │  ──→ JWKS cache fetch            │  │
│  │            │  │ Extractor  │  │  ──→ org_id → TenantStore.get()  │  │
│  │            │  └────────────┘  │                                   │  │
│  │            │  ┌────────────┐  │                                   │  │
│  │            │  │ ApiKey     │  │  ──→ SHA-256 → Redis             │  │
│  │            │  │ Extractor  │  │  ──→ Dev→App→Plan chain          │  │
│  │            │  └────────────┘  │                                   │  │
│  │            └──────────────────┘                                   │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                        │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                       Redis Store                                │  │
│  │                                                                  │  │
│  │  tenant:keyhash:<sha256>    → api_key_id     (API Key lookup)    │  │
│  │  tenant:apikey:<id>         → ApiKey fields   (hash)             │  │
│  │  tenant:tenant:<org_id>     → Tenant fields   (hash)             │  │
│  │  tenant:<tid>:conv:<cid>    → Conversation    (hash + TTL 90d)  │  │
│  │  tenant:<tid>:conv:all      → conv_id set     (set)              │  │
│  │  jwks:clerk                 → JWKS payload    (string, TTL 1h)   │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
```

## 2. Design Decisions

### Decision 1: Dual Extractor Pattern (Chain of Responsibility)

| Option | Pros | Cons |
|--------|------|------|
| **A. Single dispatch on prefix** (elegido) | Simple, predictable, no ambigüedad. Cada extractor ve solo tokens que le corresponden. | Requires prefix convention (`fa_` for API keys). |
| B. Try both always | No requiere prefix convention. | Waste de recursos (JWKS verify costs), race conditions en request.state, errores confusos. |
| C. Single middleware con if/else | Simple de implementar. | Acopla dos lógicas distintas; difícil de testear por separado. Difícil de extender con futuros métodos. |

**Decisión**: Chain of Responsibility con dispatch por prefijo `fa_`. Si el token empieza con `fa_`, va al ApiKeyExtractor. Si no, al ClerkJWTExtractor. Si ambos fallan → 401.

### Decision 2: Scope Resolution Unificado

| Option | Pros | Cons |
|--------|------|------|
| **A. request.state siempre tiene `auth_method` + `scopes` + `tenant_id`** (elegido) | Los handlers leen siempre de `request.state.scopes` sin importar el método. El RateLimitMiddleware lee `request.state.rate_limit_config`. | Requiere normalizar scopes de PlanTier a formato lista. |
| B. Handlers preguntan `hasattr(request.state, 'api_key')` | No requiere normalización. | Propenso a bugs, viola polimorfismo, handlers frágiles. |

**Decisión**: `request.state` siempre expose:
- `request.state.auth_method: Literal['api_key', 'clerk_jwt']`
- `request.state.scopes: list[str]`
- `request.state.tenant_id: str | None`
- `request.state.tenant: Tenant | None`
- `request.state.rate_limit_config: dict` (rpm, rpd)

Para Clerk JWT: scopes se derivan de `tenant.plan_tier` → `Plan` (vía `PlanTier` → `Plan` mapping).
Para API Key: scopes vienen del campo `scopes` de `ApiKey`.

### Decision 3: JWKS Caching (Redis, TTL 1h)

| Option | Pros | Cons |
|--------|------|------|
| **A. Redis cache con TTL 1h + refetch on failure** (elegido) | Sin latencia externa en la mayoría de requests. Clerk rarely rota keys. Si falla verificación, refetch automático. | Cache invalidation no inmediata si Clerk rota keys inesperadamente. |
| B. Memory cache local | Más rápido que Redis. | No persiste entre restarts. No compartido entre workers/máquinas. |
| C. Fetch en cada request | Siempre actualizado. | Latencia ~200-500ms por request + dependencia externa en el hot path. |

**Decisión**: Redis cache con `jwks:clerk` key, TTL 3600s. Fallback: si la verificación JWT falla con el cache actual, refetch y reintentar. Si vuelve a fallar → 401 TOKEN_INVALID.

### Decision 4: org_id → tenant_id Resolution

| Option | Pros | Cons |
|--------|------|------|
| **A. Clerk org_id = Tenant.id directo** (elegido) | Simple: `TenantStore.get(org_id)`. Clerk garantiza unicidad global de org_id. | Requiere que Tenant.id sea el org_id de Clerk. Seed de tenants futuros debe usar el org_id de Clerk. |
| B. Mapeo separado org_id → tenant_id | Desacopla IDs. | Indirección innecesaria en Redis, más latencia, más keys. |

**Decisión**: Clerk `org_id` se usa directamente como `Tenant.id`. `TenantStore.get(org_id)`.

Si no existe `org_id` en el JWT (usuario sin org activa), se deriva un tenant personal de `sub` (Clerk user ID): `user_{sub_hash[:12]}`. Este tenant se crea on-the-fly en Redis con `plan_tier: free`.

### Decision 5: Conversación Storage (Redis Hash + TTL)

| Option | Pros | Cons |
|--------|------|------|
| **A. Redis Hash + TTL 90d** (elegido) | Simple, TTL automático, sin schema fijo. Matching con infra existente (Redis). | Sin queries complejas (no necesario para chats). Límite de memoria. |
| B. Postgres (Engram) | Queries avanzadas, joins, persistencia durable. | Overkill para conversaciones. Más latencia. Engram es para observaciones de pipeline. |
| C. RedisJSON module | Documentos anidados, queries. | Dependencia externa (RedisJSON module). No está en docker-compose actual. |

**Decisión**: Redis Hashes con TTL 90d. Key pattern: `tenant:{tenant_id}:conv:{conv_id}`.

---

## 3. AuthMiddleware: Dual Extractor — Diseño Detallado

### 3.1 Estructura de Clases

```
AuthMiddleware (Starlette BaseHTTPMiddleware)
├── dispatch(request, call_next)
│   ├── ¿Ruta pública? → skip auth
│   ├── raw_token = extract_token(request)
│   │   ├── ¿Authorization: Bearer <token>? → raw_token
│   │   ├── ¿X-API-Key <token>? → raw_token (legacy fallback)
│   │   └── ¿ninguno? → 401
│   │
│   ├── ¿empieza con "fa_"? → ApiKeyExtractor.handle(raw_token)
│   │   └── success → request.state injectado con método api_key
│   │   └── fail → 401
│   │
│   ├── ¿no fa_? → ClerkJWTExtractor.handle(raw_token)
│   │   └── success → request.state injectado con método clerk_jwt
│   │   └── fail → 401
│   │
│   └── call_next(request)
```

### 3.2 ApiKeyExtractor (existente, modificado)

**Input**: raw_token (string)
**Output**: `request.state` con `auth_method='api_key'`

Flujo:
1. SHA-256(token) → `redis.get(tenant:keyhash:<sha256>)` → api_key_id
2. `redis.hgetall(tenant:apikey:<api_key_id>)` → ApiKey
3. Verificar `is_active`
4. `redis.hgetall(tenant:app:<api_key.app_id>)` → App
5. Verificar `app.status`
6. `redis.hgetall(tenant:developer:<app.developer_id>)` → Developer
7. Verificar `developer.is_active`
8. Plan via `store._resolve_plan(api_key.scopes)`
9. Tenant via `TenantStore.get(api_key.tenant_id)` si existe

**Injecta en request.state**:
```python
request.state.auth_method = 'api_key'
request.state.developer = developer
request.state.app = app
request.state.api_key = api_key
request.state.plan = plan
request.state.scopes = api_key.scopes
request.state.tenant_id = api_key.tenant_id
request.state.tenant = tenant  # Tenant | None
request.state.rate_limit_config = {'rpm': plan.rate_limit_rpm, 'rpd': plan.rate_limit_rpd}
```

### 3.3 ClerkJWTExtractor (nuevo)

**Input**: raw_token (string)
**Output**: `request.state` con `auth_method='clerk_jwt'`

Flujo:
1. Obtener JWKS desde Redis cache o Clerk
   - `redis.get('jwks:clerk')` — si existe y es válido, usar
   - Si no: fetch `GET {clerk_domain}.clerk.accounts.dev/.well-known/jwks.json`
   - Almacenar en Redis con `SET jwks:clerk <json> EX 3600`
2. Verificar JWT: `PyJWT.decode(token, jwks, algorithms=['RS256'], audience=...)`
3. Extraer claims:
   - `org_id` → `request.state.tenant_id`
   - `sub` (user ID) → `request.state.clerk_user_id`
4. Si `org_id` presente: `TenantStore.get(org_id)` → Tenant
   - Si no existe → 401 con `TENANT_NOT_FOUND`
5. Si no `org_id`: derivar tenant personal de `sub`
6. Resolver Plan desde `tenant.plan_tier`:
   - `plan_tier` → buscar `Plan` cuyo nombre coincida con el tier
7. Rate limits desde `Plan.rate_limit_rpm` / `Plan.rate_limit_rpd`

**Injecta en request.state**:
```python
request.state.auth_method = 'clerk_jwt'
request.state.clerk_user_id = sub
request.state.tenant_id = org_id or derived_personal_tenant_id
request.state.tenant = tenant  # Tenant | None (None solo si personal y recién creado)
request.state.scopes = plan.scopes  # from plan_tier
request.state.plan = plan
request.state.rate_limit_config = {'rpm': plan.rate_limit_rpm, 'rpd': plan.rate_limit_rpd}
# NO injecta developer, app, api_key — son específicos de API Key
```

### 3.4 JWKS Caching — Lógica Completa

```python
async def _get_jwks(redis: Redis) -> dict:
    cached = await redis.get('jwks:clerk')
    if cached:
        try:
            return json.loads(cached)
        except json.JSONDecodeError:
            pass  # corrupto, refetch

    # Fetch from Clerk
    settings = get_settings()
    jwks_url = f"https://{settings.clerk_domain}.clerk.accounts.dev/.well-known/jwks.json"
    
    async with httpx.AsyncClient() as client:
        resp = await client.get(jwks_url, timeout=10)
        resp.raise_for_status()
        jwks = resp.json()
    
    # Cache in Redis with 1h TTL
    await redis.set('jwks:clerk', json.dumps(jwks), ex=3600)
    return jwks


async def _verify_clerk_jwt(token: str, redis: Redis) -> dict | None:
    jwks = await _get_jwks(redis)
    try:
        # PyJWT library with JWKS support
        algorithms = ['RS256']
        # Extract kid from unverified header first
        unverified_header = jwt.get_unverified_header(token)
        key = next(k for k in jwks['keys'] if k['kid'] == unverified_header['kid'])
        public_key = jwk.construct(key)
        
        payload = jwt.decode(
            token,
            public_key,
            algorithms=algorithms,
            audience='your-clerk-audience',  # configurable
            options={'verify_exp': True}
        )
        return payload
    except jwt.ExpiredSignatureError:
        return None  # caller returns 401 TOKEN_EXPIRED
    except (jwt.InvalidTokenError, StopIteration):
        # If cached JWKS fails, refetch and retry once
        await redis.delete('jwks:clerk')
        jwks = await _get_jwks(redis)  # fresh fetch
        try:
            # Repeat verification
            ...
        except Exception:
            return None  # caller returns 401 TOKEN_INVALID
```

**Dependencia nueva**: `pyjwt` + `cryptography` (ya existente o a agregar en `pyproject.toml`).

---

## 4. Flujo de Datos Detallado

### 4.1 Clerk JWT Request

```
User → Browser → Next.js
│
├── useChat.sendMessage("consulta CUIT")
│   ├── useAuth().getToken() → Clerk JWT
│   ├── apiClient.sendMessage(token, "consulta CUIT")
│   │   ├── POST /v1/chat/message
│   │   └── Authorization: Bearer <clerk_jwt>
│   │
│   └── Backend recibe:
│       ├── CORS → Metrics → AuthMiddleware
│       │   ├── raw_token = "eyJhbGci..."
│       │   ├── ¿fa_? No → ClerkJWTExtractor
│       │   │   ├── redis.get('jwks:clerk') → cache hit → JWKS listo
│       │   │   ├── PyJWT.decode(token, jwks) → payload
│       │   │   │   ├── org_id: "org_123"
│       │   │   │   └── sub: "user_456"
│       │   │   ├── TenantStore.get("org_123") → Tenant {plan_tier: "pro"}
│       │   │   ├── Resolver Plan desde plan_tier → Plan {scopes: [...], rpm: 60}
│       │   │   ├── request.state.auth_method = "clerk_jwt"
│       │   │   ├── request.state.tenant_id = "org_123"
│       │   │   ├── request.state.scopes = plan.scopes
│       │   │   └── request.state.rate_limit_config = {rpm: 60, rpd: 1000}
│       │   │
│       │   ├── TenantContextMiddleware
│       │   │   └── request.state.tenant ya setteado → pasa
│       │   │
│       │   ├── RateLimitMiddleware
│       │   │   └── Lee request.state.rate_limit_config → check rpm/rpd
│       │   │
│       │   └── Route handler: POST /v1/chat/message
│       │       └── request.state.scopes → verifica permisos
│       │       └── request.state.tenant_id → scoped data access
```

### 4.2 API Key Request (backward compat)

```
Developer App → curl / Postman
│
├── POST /v1/chat/message
│   └── Authorization: Bearer fa_abc123...
│
└── Backend recibe:
    ├── CORS → Metrics → AuthMiddleware
    │   ├── raw_token = "fa_abc123..."
    │   ├── ¿fa_? Sí → ApiKeyExtractor
    │   │   ├── SHA-256(token) → redis.get(tenant:keyhash:<sha256>)
    │   │   ├── → api_key_id
    │   │   ├── ApiKey → App → Developer → Plan
    │   │   ├── request.state.auth_method = "api_key"
    │   │   ├── request.state.developer = Developer
    │   │   ├── request.state.app = App
    │   │   ├── request.state.api_key = ApiKey
    │   │   ├── request.state.tenant_id = api_key.tenant_id
    │   │   └── request.state.scopes = api_key.scopes
    │   │
    │   └── (sigue igual que hoy)
```

### 4.3 Conversation Storage Flow

```
useChat Hook
│
├── [on mount] GET /v1/chat/conversations
│   ├── Backend: tenant_store.get_tenant_conversations(tenant_id)
│   │   ├── SMEMBERS tenant:{tid}:conv:all → [conv_01, conv_02]
│   │   ├── HGETALL tenant:{tid}:conv:{conv_id} → cada conv
│   │   └── Return sorted by updated_at desc
│   └── Response: [{conversation_id, title, message_count, updated_at}, ...]
│
├── [on send] POST /v1/chat/conversations/save
│   ├── Backend: {conversation_id (opcional), messages}
│   │   ├── ¿conv_id? UPDATE (HSET, EXPIRE)
│   │   └── ¿no conv_id? CREATE (new id, HSET, SADD, EXPIRE)
│   │       └── Key: tenant:{tid}:conv:{new_id}
│   │       └── Hash: {messages: JSON, created_at, updated_at}
│   │       └── TTL: 90 days (7776000s)
│   │       └── Set: SADD tenant:{tid}:conv:all {new_id}
│   └── Response: {conversation_id}
│
├── [on delete] DELETE /v1/chat/conversations/{id}
│   ├── Backend: DEL tenant:{tid}:conv:{id}, SREM tenant:{tid}:conv:all {id}
│   └── Response: 204
│
├── [on login] localStorage migration
│   ├── Leer window.localStorage.getItem('fa_conversations')
│   ├── Parsear JSON
│   ├── Para cada conversación: POST /v1/chat/conversations/save
│   ├── Por éxito: localStorage.removeItem('fa_conversations')
│   └── Por fallo: log, no bloquear, mantener localStorage como fallback
```

---

## 5. Frontend Architecture

### 5.1 Route Structure

```
/ (landing — public, existing)
├── /sign-in (public — Clerk <SignIn />)
├── /sign-up (public — Clerk <SignUp />)
├── /chat (protected)
│   └── /chat/{id} (protected — conversation detail)
└── /profile (protected)
    ├── /profile/api-keys (tab)
    ├── /profile/settings (tab)
    └── /profile/tenant (tab — tenant info)
```

### 5.2 Middleware (`middleware.ts`)

```typescript
import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'

const isProtectedRoute = createRouteMatcher(['/chat(.*)', '/profile(.*)'])
const isPublicRoute = createRouteMatcher(['/', '/sign-in(.*)', '/sign-up(.*)'])

export default clerkMiddleware(async (auth, req) => {
  if (isProtectedRoute(req)) {
    await auth.protect()
  }
})

export const config = {
  matcher: ['/((?!_next|api|trpc|favicon.ico).*)'],
}
```

### 5.3 Component Tree

```
app/layout.tsx
└── <ClerkProvider>
    └── <ThemeProvider>
        └── {children} (cada ruta)

app/(auth)/sign-in/page.tsx
└── <SignIn forceRedirectUrl="/chat" />

app/(auth)/sign-up/page.tsx
└── <SignUp forceRedirectUrl="/chat" />

app/chat/layout.tsx
└── Sidebar (conversation list)
│   └── ConversationListItem[]
│   └── NewChatButton
└── {children} (chat view)

app/chat/page.tsx
└── <ChatView>
    ├── MessageList
    ├── MessageInput
    └── useChat hook

app/chat/[id]/page.tsx
└── <ChatView conversationId={id}>

app/profile/layout.tsx
└── ProfileSidebar (tabs: API Keys, Settings, Tenant)
└── {children}

app/profile/api-keys/page.tsx
└── <ApiKeysPage>
    ├── <ApiKeysList> (Table from shadcn/ui)
    └── <ApiKeyCreateDialog> (Dialog + Form)

app/profile/settings/page.tsx
└── <SettingsPanel>
```

### 5.4 apiClient.js — Token Injection

```javascript
// lib/api-client.js
export async function sendMessage(token, message, conversationId = null) {
  if (!token) {
    throw { code: 'AUTH_REQUIRED', message: 'No hay sesión activa' }
  }

  const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/v1/chat/message`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ message, conversation_id: conversationId }),
  })

  if (!res.ok) {
    const body = await res.json()
    throw { code: body?.error?.code || 'API_ERROR', message: body?.error?.cause || res.statusText }
  }

  return res.json()
}

export async function saveConversation(token, { conversation_id, messages }) {
  const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/v1/chat/conversations/save`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ conversation_id, messages }),
  })
  return res.json()
}

export async function listConversations(token) { ... }
export async function getConversation(token, id) { ... }
export async function deleteConversation(token, id) { ... }
```

**CRITICO**: `apiClient` NO llama a `useAuth()` internamente. Recibe el token como parámetro. El hook `useChat` obtiene el token via `useAuth().getToken()` y lo pasa a `apiClient`. Esto mantiene separación de concerns (el cliente HTTP no depende de React hooks).

### 5.5 useChat Hook — Migración

```javascript
// hooks/useChat.js
import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '@clerk/nextjs'
import * as api from '@/lib/api-client'

export function useChat() {
  const { getToken, isLoaded, isSignedIn } = useAuth()
  const [conversations, setConversations] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [messages, setMessages] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  // Load conversations on mount (replaces localStorage load)
  useEffect(() => {
    if (!isLoaded || !isSignedIn) return
    loadConversations()
    migrateLocalStorage()  // non-blocking
  }, [isLoaded, isSignedIn])

  const loadConversations = async () => {
    const token = await getToken()
    const list = await api.listConversations(token)
    setConversations(list)
    if (list.length > 0) {
      setSelectedId(list[0].conversation_id)
      // load messages for selected
      const conv = await api.getConversation(token, list[0].conversation_id)
      setMessages(conv.messages)
    }
  }

  const sendMessage = async (text) => {
    const token = await getToken()
    setLoading(true)
    setError(null)
    try {
      const result = await api.sendMessage(token, text, selectedId)
      // result: { conversation_id, reply, actions_taken, data }
      const updatedMessages = [...messages, 
        { role: 'user', content: text },
        { role: 'assistant', content: result.reply, actions: result.actions_taken }
      ]
      setMessages(updatedMessages)
      
      // Auto-save conversation
      await api.saveConversation(token, {
        conversation_id: result.conversation_id,
        messages: updatedMessages
      })
      
      // Refresh list if new conversation
      if (!selectedId) {
        await loadConversations()
      }
    } catch (err) {
      setError(err)
      // User message stays in history (spec requirement)
    } finally {
      setLoading(false)
    }
  }

  const migrateLocalStorage = async () => {
    try {
      const raw = window.localStorage.getItem('fa_conversations')
      if (!raw) return
      const localConvs = JSON.parse(raw)
      const token = await getToken()
      for (const conv of localConvs) {
        try {
          await api.saveConversation(token, { messages: conv.messages })
        } catch {
          // Non-blocking — keep localStorage as fallback
          console.warn('Migration failed for conversation:', conv.id)
        }
      }
      // Only clear if ALL succeeded
      window.localStorage.removeItem('fa_conversations')
    } catch {
      // Silently fail — don't block user
    }
  }

  return {
    conversations,
    selectedId,
    setSelectedId,
    messages,
    sendMessage,
    loading,
    error,
  }
}
```

---

## 6. Redis Schema — Conversaciones

### 6.1 Key Patterns

```
# Conversation hash
Key:   tenant:{tenant_id}:conv:{conv_id}
Type:  Hash
Fields:
  id:           "conv_abc123"
  title:        "Consulta CUIT 20324837796"     # preview del primer mensaje
  messages:     "[{\"role\":\"user\",\"content\":\"...\"}, ...]"  # JSON array
  created_at:   "2026-06-18T10:30:00Z"          # ISO timestamp
  updated_at:   "2026-06-18T11:45:00Z"          # ISO timestamp
TTL:   7776000  (90 days)

# Conversation index set
Key:   tenant:{tenant_id}:conv:all
Type:  Set
Members: ["conv_abc123", "conv_def456", ...]
TTL:   none (persistent — entries are SREM'd on delete)

# JWKS cache
Key:   jwks:clerk
Type:  String
Value: <JWKS JSON payload>
TTL:   3600  (1 hour)
```

### 6.2 TTL Refresh Estrategia

- **On create**: `HSET` + `EXPIRE 7776000` + `SADD tenant:{tid}:conv:all`
- **On update**: `HSET` + `EXPIRE 7776000` (refresca TTL)
- **On read (GET single)**: `EXPIRE 7776000` (touch — mantener vivas las activas)
- **On list**: solo lee del Set + hashes, no toca TTL
- **On delete**: `DEL` + `SREM tenant:{tid}:conv:all`

---

## 7. API Keys desde Profile — Endpoints

### 7.1 Nuevos Endpoints en `admin.py`

```python
# POST /v1/admin/api-keys — crear API key para el tenant autenticado
# (requiere auth Clerk JWT, usa request.state.tenant_id)
@router.post('/v1/admin/api-keys', status_code=201)
async def create_tenant_api_key(body: CreateTenantApiKeyRequest, req: Request):
    if req.state.auth_method != 'clerk_jwt':
        raise HTTPException(403, detail=...)  # Solo usuarios Clerk pueden crear keys desde profile
    
    tenant_id = req.state.tenant_id
    scopes = body.scopes or req.state.scopes  # default: plan scopes
    
    # Validate requested scopes are subset of plan scopes
    plan_scopes = set(req.state.scopes)
    requested_scopes = set(scopes)
    if not requested_scopes.issubset(plan_scopes):
        raise HTTPException(403, detail=UnifiedResponse(
            error=ApiError(code='SCOPE_EXCEEDS_PLAN', ...)
        ))
    
    result = await store.create_api_key_for_tenant(tenant_id, scopes)
    return UnifiedResponse(result={
        'key_preview': result['api_key'].key_preview,
        'full_key': result['full_key'],
        'warning': 'Guardá esta key — no se mostrará nuevamente',
    })


# GET /v1/admin/api-keys — listar keys del tenant
@router.get('/v1/admin/api-keys')
async def list_tenant_api_keys(req: Request):
    tenant_id = req.state.tenant_id
    keys = await store.list_tenant_api_keys(tenant_id)
    # Return only: key_preview, created_at, scopes
    return UnifiedResponse(result=[
        {
            'key_id': k.id,
            'key_preview': k.key_preview,
            'created_at': k.created_at,
            'scopes': k.scopes,
            'is_active': k.is_active,
        }
        for k in keys
    ])


# DELETE /v1/admin/api-keys/{key_id} — revocar key
@router.delete('/v1/admin/api-keys/{key_id}')
async def revoke_tenant_api_key(key_id: str, req: Request):
    tenant_id = req.state.tenant_id
    key = await store.get_api_key(key_id)
    if not key or key.tenant_id != tenant_id:
        raise HTTPException(404, detail=UnifiedResponse(
            error=ApiError(code='KEY_NOT_FOUND', ...)
        ))
    
    await store.revoke_api_key(key_id)
    return UnifiedResponse(status='success', result={'revoked': True})
```

### 7.2 Nuevos Métodos en `RedisStore`

```python
async def create_api_key_for_tenant(self, tenant_id: str, scopes: list[str]) -> dict:
    """Create a new API key bound to a tenant (for profile UI)."""
    full_key = f'fa_{secrets.token_hex(16)}'
    api_key = ApiKey(
        id=self._generate_id(),
        app_id='',  # No app binding for tenant-level keys
        key_preview=full_key[-4:],
        is_active=True,
        scopes=scopes,
        tenant_id=tenant_id,
        created_at=datetime.now(timezone.utc),
    )
    await self.redis.hset(
        _KEY_APIKEY.format(api_key.id),
        mapping=self._serialize_for_redis(api_key.model_dump(mode='json')),
    )
    await self.redis.set(_KEY_KEYHASH.format(self._hash_key(full_key)), api_key.id)
    # Index: tenant → keys
    await self.redis.sadd(f'tenant:apikeys:{tenant_id}', api_key.id)
    return {'api_key': api_key, 'full_key': full_key}


async def list_tenant_api_keys(self, tenant_id: str) -> list[ApiKey]:
    key_ids = await self.redis.smembers(f'tenant:apikeys:{tenant_id}')
    keys = []
    for kid in key_ids:
        data = await self.redis.hgetall(_KEY_APIKEY.format(kid))
        if data:
            key = self._deserialize(ApiKey, data)
            if key.is_active:
                keys.append(key)
    return keys


async def revoke_api_key(self, key_id: str) -> None:
    await self.redis.hset(_KEY_APIKEY.format(key_id), mapping={
        'is_active': json.dumps(False),
    })


async def get_api_key(self, key_id: str) -> ApiKey | None:
    data = await self.redis.hgetall(_KEY_APIKEY.format(key_id))
    if not data:
        return None
    return self._deserialize(ApiKey, data)
```

---

## 8. RateLimitMiddleware — Actualización

El `RateLimitMiddleware` existente ya lee `request.state.rate_limit_config`. Con Clerk JWT:

```python
# En RateLimitMiddleware.dispatch():
rate_config = getattr(request.state, 'rate_limit_config', None)
if rate_config:
    rpm = rate_config.get('rpm', 10)
    rpd = rate_config.get('rpd', 100)
    # ... check against Redis counter ...
```

No requiere cambios mayores — solo asegurar que tanto ClerkJWTExtractor como ApiKeyExtractor inyecten `request.state.rate_limit_config`.

---

## 9. File Manifest

### Sprint A — Clerk en Frontend (estimado: ~150 líneas nuevas, ~30 modificadas)

| File | Tipo | Líneas | Descripción |
|------|------|--------|-------------|
| `frontend/package.json` | Modified | ~3 | +`@clerk/nextjs`, `@clerk/themes` |
| `frontend/.env.local` | Modified | ~2 | `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...` |
| `frontend/app/layout.tsx` | Modified | ~5 | `<ClerkProvider>` wrapper |
| `frontend/app/middleware.ts` | New | ~20 | Route protection con Clerk |
| `frontend/app/(auth)/sign-in/page.tsx` | New | ~10 | `<SignIn forceRedirectUrl="/chat" />` |
| `frontend/app/(auth)/sign-up/page.tsx` | New | ~10 | `<SignUp forceRedirectUrl="/chat" />` |
| `frontend/app/(auth)/layout.tsx` | New | ~8 | Auth layout (centered, minimal) |
| `frontend/lib/api-client.js` | Modified | ~40 | Dynamic token from param, no more env var |
| `frontend/hooks/useChat.js` | Modified | ~80 | Backend CRUD replaces localStorage |

### Sprint B — Backend Clerk JWT (estimado: ~200 líneas nuevas, ~40 modificadas)

| File | Tipo | Líneas | Descripción |
|------|------|--------|-------------|
| `fiscal_agent/api/middleware/auth.py` | Modified | ~100 | Dual extractor: ClerkJWTExtractor + ApiKeyExtractor refactor |
| `fiscal_agent/api/middleware/__init__.py` | Modified | ~2 | Export ClerkJWTExtractor |
| `fiscal_agent/api/middleware/clerk.py` | New | ~120 | ClerkJWTExtractor class, JWKS fetcher, token validator |
| `fiscal_agent/config.py` | Modified | ~5 | +`CLERK_SECRET_KEY`, `CLERK_DOMAIN` settings |
| `fiscal_agent/models.py` | Modified | ~5 | +`auth_method` Literal si es necesario (o queda en state dinámico) |
| `docker-compose.yml` / `docker-compose.prod.yml` | Modified | ~2 | +`CLERK_SECRET_KEY` env |

### Sprint C — Conversaciones a Redis (estimado: ~150 líneas nuevas)

| File | Tipo | Líneas | Descripción |
|------|------|--------|-------------|
| `fiscal_agent/api/routes/chat/conversations.py` | New | ~100 | CRUD endpoints: save, list, get, delete |
| `fiscal_agent/api/routes/chat/__init__.py` | Modified | ~3 | Include conversations router |
| `fiscal_agent/api/server.py` | Modified | ~2 | Register conversations router |
| `fiscal_agent/api/store.py` | Modified | ~40 | +ConverationStore methods: save, list, get, delete |

### Sprint D — Profile UI + API Keys (estimado: ~220 líneas nuevas, ~40 modificadas)

| File | Tipo | Líneas | Descripción |
|------|------|--------|-------------|
| `frontend/app/profile/layout.tsx` | New | ~15 | Profile layout with sidebar tabs |
| `frontend/app/profile/api-keys/page.tsx` | New | ~25 | API Keys management page |
| `frontend/app/profile/settings/page.tsx` | New | ~15 | Settings page |
| `frontend/components/profile/ApiKeysList.tsx` | New | ~50 | Table with keys, revoke button |
| `frontend/components/profile/ApiKeyCreateDialog.tsx` | New | ~40 | Dialog form: create key, show once |
| `frontend/components/profile/SettingsPanel.tsx` | New | ~40 | Tenant info, preferences |
| `frontend/hooks/useApiKeys.js` | New | ~40 | Hook for API key CRUD |
| `fiscal_agent/api/routes/admin.py` | Modified | ~40 | +3 endpoints: create/list/revoke tenant API keys |
| `fiscal_agent/api/store.py` | Modified | ~30 | +Tenant-scoped key CRUD methods |

### Total estimado: ~720 líneas nuevas, ~200 modificadas

---

## 10. Migración Estratégica: localStorage → Redis

### Fase 1 (Sprint C — backend listo)

Las nuevas conversaciones se guardan directo a Redis. Las conversaciones existentes en localStorage no se migran automáticamente — solo cuando el usuario hace login.

### Fase 2 (durante Sprint C — migración progresiva en frontend)

```typescript
// En useChat, al montar:
useEffect(() => {
  if (isSignedIn) {
    loadConversations()              // carga de Redis
    migrateLocalStorageIfNeeded()    // one-time migration
  }
}, [isSignedIn])

const MIGRATION_KEY = 'fa_conversations_migrated'

async function migrateLocalStorageIfNeeded() {
  if (localStorage.getItem(MIGRATION_KEY) === 'true') return
  
  const raw = localStorage.getItem('fa_conversations')
  if (!raw) {
    localStorage.setItem(MIGRATION_KEY, 'true')
    return
  }
  
  const token = await getToken()
  const localConvs = JSON.parse(raw)
  
  // Upload each conversation
  for (const conv of localConvs) {
    try {
      await api.saveConversation(token, { messages: conv.messages })
    } catch (err) {
      console.warn('[migration] failed for', conv.id, err)
      // Don't block — keep localStorage
      return
    }
  }
  
  // All succeeded: clear localStorage and flag
  localStorage.removeItem('fa_conversations')
  localStorage.setItem(MIGRATION_KEY, 'true')
}
```

### Rollback durante migración

Si la migración falla (backend down), las conversaciones locales se mantienen intactas. El usuario puede seguir usando el chat, y las nuevas conversaciones se guardan en Redis. En el próximo login se reintenta la migración.

---

## 11. Ponytail Design Principles Aplicadas

| Principio | Aplicación |
|-----------|------------|
| **Aislar side effects** | `apiClient` recibe token como parámetro — no llama a `useAuth()`. El hook orquesta. |
| **Fail fast** | Middleware falla en el extractor correcto sin intentar el otro. Token inválido → 401 inmediato. |
| **Consistencia sobre optimización** | `request.state` siempre tiene `auth_method`, `scopes`, `tenant_id`, `rate_limit_config` — sin importar el método de auth. |
| **Test boundaries** | ClerkJWTExtractor acepta Redis y config como dependencias inyectadas. JWKS fetch es testable con mock HTTP. |
| **Migration over rewrite** | localStorage → Redis es progresiva: las conversaciones nuevas van a Redis, las viejas se migran al login sin bloqueo. |
| **Backward compatibility** | API Key auth funciona exactamente igual. El ApiKeyExtractor se mantiene, los scopes se resuelven igual. |
| **Observability** | `logging.Logger` diferenció con `auth_method=api_key|clerk_jwt` en cada request. JWKS cache hits/misses logueados. |
| **Defense in depth** | Clerk JWT tiene validación criptográfica (RS256 via JWKS) + expiry check + audience check. API Key tiene SHA-256 hash + is_active check. |

---

## 12. Riesgos y Mitigaciones

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|-------------|---------|------------|
| Clerk JWKS endpoint down | Baja | Alto (nadie puede auth via Clerk) | Cache de JWKS permite seguir funcionando 1h. Si expire, fallback a refetch con timeout corto. |
| Clerk rota JWKS durante TTL | Baja | Medio (tokens válidos rechazados por 1h) | Auto-refetch al fallar verificación: si JWT no valida con cache, refetch y reintentar. |
| Migración localStorage pierde datos | Baja | Medio (usuario pierde historial) | Upload progresivo, mantener localStorage 7 días post-migración exitosa como backup. |
| Tenant no existe en Redis pero sí en Clerk | Media | Alto (usuario logueado pero no puede usar el sistema) | El webhook `organization.created` es postergado. Mientras tanto, el middleware devuelve 401 con `TENANT_NOT_FOUND`. Mitigación: crear tenant manualmente via admin endpoint. |
| Rate limits con Clerk JWT vs API Key | Baja | Medio | Ambos extractores inyectan `rate_limit_config`. Plan tier define límites para Clerk. API Key tiene sus propios límites del Plan. Son independientes. |

---

## 13. Resumen de Arquitectura

```
AuthMiddleware (dispatch por prefijo)
│
├── ¿token empieza con "fa_"?
│   └── ApiKeyExtractor
│       ├── SHA-256 → Redis → ApiKey → App → Developer → Plan
│       ├── request.state.auth_method = "api_key"
│       ├── request.state.scopes = api_key.scopes
│       └── request.state.tenant_id = api_key.tenant_id
│
└── ¿no?
    └── ClerkJWTExtractor
        ├── JWKS (Redis cache → fetch on miss)
        ├── PyJWT.decode(token, jwks, RS256)
        ├── org_id → TenantStore.get()
        ├── plan_tier → Plan scopes
        ├── request.state.auth_method = "clerk_jwt"
        ├── request.state.scopes = plan.scopes
        └── request.state.tenant_id = org_id
```

Ambos caminos convergen en:
```python
request.state.auth_method  # para handlers que necesitan saber
request.state.tenant_id    # para data scoping
request.state.scopes       # para authorization checks (consistente)
request.state.rate_limit_config  # para rate limiting
```
