# Tasks — Clerk Frontend Auth

> Generated from proposal, design, and delta specs. Organized by sprint (A → D) with
> phases within each sprint. Each task is a self-contained work unit with test criteria.

---

## Sprint A — Clerk en Chat UI

**Goal**: Integrate Clerk authentication into the Next.js frontend so the Chat UI requires login.

### A.1 — Agregar `@clerk/nextjs` a package.json y configurar variables de entorno

| Field | Value |
|-------|-------|
| **Archivos** | `frontend/IdeaDashboardai-chatbot-interface-template/package.json` (+3 líneas), `frontend/IdeaDashboardai-chatbot-interface-template/.env.local` (+2 líneas) |
| **Líneas estimadas** | ~5 agregadas |
| **Dependencias** | Ninguna |
| **Duración** | Small |

**Descripción**: Agregar `@clerk/nextjs` y `@clerk/themes` como dependencias en `package.json`. Crear `.env.local` con `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` (valor dummy `pk_test_...` para desarrollo). No tocar `NEXT_PUBLIC_API_KEY` aún — coexiste hasta Sprint A.4.

**Criterios de test**:
- `pnpm install` no falla
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` es accesible en runtime

**Commit unit**: `feat(auth): add @clerk/nextjs dependency and env vars`

---

### A.2 — Envolver RootLayout con `<ClerkProvider>` y agregar `<ThemeProvider>`

| Field | Value |
|-------|-------|
| **Archivos** | `frontend/IdeaDashboardai-chatbot-interface-template/app/layout.tsx` (~8 líneas modificadas) |
| **Líneas estimadas** | ~8 modificadas |
| **Dependencias** | A.1 |
| **Duración** | Small |

**Descripción**: Modificar `layout.tsx` para importar `ClerkProvider` de `@clerk/nextjs` y wrap children. Asegurar que `publishableKey` se resuelve de `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`. Mantener `<ThemeProvider>` preexistente dentro del árbol. Ubicación: `<ClerkProvider>` solo envuelve children (no el `<html>`). Si el layout actual no tiene ThemeProvider como hijo directo, verificar el árbol de componentes.

**Criterios de test**:
- App renderiza sin error con `ClerkProvider`
- `useAuth()` disponible en componentes client

**Commit unit**: `feat(auth): wrap root layout with ClerkProvider`

---

### A.3 — Crear middleware.ts de Clerk para route protection

| Field | Value |
|-------|-------|
| **Archivos** | `frontend/IdeaDashboardai-chatbot-interface-template/app/middleware.ts` (nuevo, ~20 líneas) |
| **Líneas estimadas** | ~20 nuevas |
| **Dependencias** | A.2 |
| **Duración** | Small |

**Descripción**: Crear `middleware.ts` usando `clerkMiddleware` de `@clerk/nextjs/server`. Rutas protegidas: `/`, `/profile(.*)`. Rutas públicas: `/sign-in(.*)`, `/sign-up(.*)`. Matcher exclude: `_next`, `api`, `trpc`, `favicon.ico`. Usar `auth.protect()` para las protegidas (auto-redirect a sign-in).

> **Nota**: El chat (AIAssistantUI) vive en `/` (raíz), no en `/chat`. No existe ruta `/chat` en la app.

**Criterios de test**:
- Usuario no autenticado que navega a `/` es redirigido a `/sign-in` con `redirect_url=%2F`
- Usuario autenticado pasa sin redirect
- `/sign-in` y `/sign-up` son accesibles sin auth

**Commit unit**: `feat(auth): add Clerk middleware for route protection`

---

### A.4 — Crear páginas de Sign-In / Sign-Up

| Field | Value |
|-------|-------|
| **Archivos** | `frontend/IdeaDashboardai-chatbot-interface-template/app/(auth)/sign-in/page.tsx` (nuevo, ~10 líneas), `frontend/IdeaDashboardai-chatbot-interface-template/app/(auth)/sign-up/page.tsx` (nuevo, ~10 líneas), `frontend/IdeaDashboardai-chatbot-interface-template/app/(auth)/layout.tsx` (nuevo, ~8 líneas) |
| **Líneas estimadas** | ~28 nuevas |
| **Dependencias** | A.3 |
| **Duración** | Small |

**Descripción**: Crear route group `(auth)` con layout minimal centrado. `sign-in/page.tsx` usa `<SignIn forceRedirectUrl="/" />`. `sign-up/page.tsx` usa `<SignUp forceRedirectUrl="/" />`. Ambos componentes de Clerk. Layout: contenedor centrado con padding, sin sidebar ni header.

> **Nota**: `forceRedirectUrl="/"` porque el chat vive en la raíz, no hay ruta `/chat`.

**Criterios de test**:
- `/sign-in` renderiza formulario de login de Clerk
- `/sign-up` renderiza formulario de registro
- Post-auth redirect funciona a `/` (el chat)

**Commit unit**: `feat(auth): add sign-in and sign-up pages with Clerk components`

---

### A.5 — Modificar api-client.js para aceptar token dinámico

| Field | Value |
|-------|-------|
| **Archivos** | `frontend/IdeaDashboardai-chatbot-interface-template/lib/api-client.js` (~40 líneas modificadas) |
| **Líneas estimadas** | ~40 modificadas |
| **Dependencias** | A.4 |
| **Duración** | Small |

**Descripción**: Refactor `api-client.js` para que cada función exportada reciba `token` como primer parámetro. Eliminar dependencia de `NEXT_PUBLIC_API_KEY` como bearer token estático. Las funciones (`sendMessage`, `sendMessageStream`) ya no leen `API_KEY` del env — reciben `token` del caller. Agregar funciones nuevas: `saveConversation(token, data)`, `listConversations(token)`, `getConversation(token, id)`, `deleteConversation(token, id)`.

**Contrato**: `apiClient` NUNCA llama a `useAuth()` — recibe token como parámetro.

**Criterios de test**:
- `sendMessage("consulta CUIT", "token123")` envía `Authorization: Bearer token123`
- `sendMessage("consulta", null, [], {onProgress})` funciona con streaming
- Si token es null/falsy, lanza `AUTH_REQUIRED`
- `NEXT_PUBLIC_API_KEY` puede eliminarse o coexistir sin usarse

**Commit unit**: `feat(auth): refactor api-client.js to accept dynamic token parameter`

---

### A.6 — Modificar useChat.js para obtener token via `useAuth().getToken()`

| Field | Value |
|-------|-------|
| **Archivos** | `frontend/IdeaDashboardai-chatbot-interface-template/hooks/useChat.js` (~80 líneas modificadas) |
| **Líneas estimadas** | ~80 modificadas |
| **Dependencias** | A.5 |
| **Duración** | Medium |

**Descripción**: Modificar `useChat.js` para:
1. Importar `useAuth` de `@clerk/nextjs` y obtener `getToken, isLoaded, isSignedIn`
2. Reemplazar `loadFromStorage()` y `saveToStorage()` con llamadas a `api.listConversations(token)` y `api.saveConversation(token, data)` en mount
3. `sendMessage`: obtener token con `getToken()` antes de llamar a `apiClient.sendMessage(token, ...)`
4. Agregar `migrateLocalStorage()`: al login, leer localStorage, subir cada conversación via `api.saveConversation`, limpiar localStorage si todas se suben
5. Mantener AUTH_REQUIRED como error UX: si no hay sesión, el middleware ya redirige
6. `newConversation`, `selectConversation`, `deleteConversation`, `renameConversation` deben persistir via API

**Diseño detallado** ver design.md sección 5.5. La migración de localStorage es no-bloqueante (no interfiere con la UX del chat).

**Criterios de test**:
- Hook retorna `loading=false` y error null en mount si hay sesión
- `sendMessage()` llama `getToken()` y lo pasa a `apiClient`
- `loadConversations()` se llama en mount con token
- `migrateLocalStorage()` sube conversaciones al login sin bloquear
- Si `getToken()` retorna null, `sendMessage()` no llama a apiClient

**Commit unit**: `feat(auth): update useChat hook with Clerk token and backend persistence`

---

### A.7 — Modificar Header/Sidebar para mostrar usuario logueado

| Field | Value |
|-------|-------|
| **Archivos** | `frontend/IdeaDashboardai-chatbot-interface-template/components/Header.jsx` (~15 líneas modificadas), `frontend/IdeaDashboardai-chatbot-interface-template/components/Sidebar.jsx` (~30 líneas modificadas) |
| **Líneas estimadas** | ~45 modificadas |
| **Dependencias** | A.6 |
| **Duración** | Small |

**Descripción**: 
- **Header.jsx**: Agregar avatar de usuario (via `useUser().user` de Clerk) y nombre a la derecha del header. Agregar botón de sign-out (usa `useClerk().signOut()`).
- **Sidebar.jsx**: Reemplazar el hardcoded "John Doe" con datos dinámicos de `useUser()`. Cambiar "Espacio profesional" por org name o email. Al hacer click en el avatar, menú dropdown con "Profile" (link a `/profile`) y "Sign out".

**Criterios de test**:
- Header muestra avatar y nombre del usuario logueado
- Sidebar muestra datos reales del usuario
- Sign-out redirige a `/sign-in`
- Componentes no rompen si usuario no está cargado (loading state)

**Commit unit**: `feat(auth): display logged-in user in Header and Sidebar`

---

### A.8 — Actualizar next.config.mjs y verificar rewrites

| Field | Value |
|-------|-------|
| **Archivos** | `frontend/IdeaDashboardai-chatbot-interface-template/next.config.mjs` (~2 líneas modificadas) |
| **Líneas estimadas** | ~2 modificadas |
| **Dependencias** | A.5 |
| **Duración** | Small |

**Descripción**: Verificar que `next.config.mjs` rewrites sigan siendo válidos con el nuevo esquema de auth. Las rewrites de `/api/:path*` al backend no requieren cambio funcional (el token se envía en Authorization header, no pasa por rewrite). Opcional: agregar `serverExternalPackages` si Clerk requiere algo. Verificar `images.unoptimized` para avatar de Clerk.

**Criterios de test**:
- Rewrites funcionan con token Bearer en Authorization header
- Clerk avatar images cargan (podría necesitar dominio en images.remotePatterns)

**Commit unit**: `chore(config): update next.config.mjs for Clerk compatibility`

---

## Sprint B — Backend Clerk JWT

**Goal**: Backend accepts and validates Clerk JWTs via a new ClerkJWTExtractor, coexisting with API Key auth.

### B.1 — Crear `fiscal_agent/api/middleware/clerk.py` — ClerkJWTExtractor

| Field | Value |
|-------|-------|
| **Archivos** | `fiscal_agent/api/middleware/clerk.py` (nuevo, ~120 líneas) |
| **Líneas estimadas** | ~120 nuevas |
| **Dependencias** | Ninguna (independiente, se integra en B.2) |
| **Duración** | Medium |

**Descripción**: Implementar clase `ClerkJWTExtractor` con:
- `_get_jwks(redis)` — fetch JWKS desde Clerk, cachear en Redis key `jwks:clerk` con TTL 3600s. Si cache corrupto o vacío, fetch desde `https://{clerk_domain}.clerk.accounts.dev/.well-known/jwks.json` usando `httpx.AsyncClient`. Si fetch falla, reintentar con timeout corto. Loguear cache hits/misses.
- `verify_jwt(token, redis)` — extraer `kid` del unverified header, buscar key correspondiente en JWKS, construir `jwk`, decodificar con `PyJWT.decode()`. Validar: RS256, audience, expiry. Fallo con cache → refetch JWKS → reintentar una vez. Retorna payload o None.
- `handle(token, request, redis)` — método público que: (1) verifica JWT, (2) extrae `org_id` y `sub`, (3) resuelve tenant via `TenantStore.get(org_id)`, (4) resuelve plan desde `tenant.plan_tier` buscando Plan cuyo nombre coincida, (5) inyecta `request.state`. Si no hay `org_id`, deriva tenant personal de `sub` (`user_{hash[:12]}`) y lo crea on-the-fly en Redis con `plan_tier: free`. Si existe `org_id` pero tenant no existe en Redis → 401 `TENANT_NOT_FOUND`.

**Inyecta en request.state**:
```python
request.state.auth_method = 'clerk_jwt'
request.state.clerk_user_id = sub
request.state.tenant_id = org_id or personal_tenant_id
request.state.tenant = tenant  # or None for new personal tenants
request.state.scopes = plan.scopes
request.state.plan = plan
request.state.rate_limit_config = {'rpm': plan.rate_limit_rpm, 'rpd': plan.rate_limit_rpd}
```

**Dependencias a agregar**: `pyjwt`, `cryptography` (en `pyproject.toml` o `setup.cfg`).

**Criterios de test**:
- JWT válido con org_id → payload extraído, tenant resuelto
- JWT expirado → retorna None (caller retorna 401 `TOKEN_EXPIRED`)
- JWT con firma inválida → retorna None (caller retorna 401 `TOKEN_INVALID`)
- JWKS cache hit → no fetch externo
- JWKS cache miss → fetch externo, se guarda en Redis
- Sin org_id → tenant personal derivado de sub

**Commit unit**: `feat(backend): add ClerkJWTExtractor with JWKS caching and org_id resolution`

---

### B.2 — Modificar AuthMiddleware para dual extractor dispatch

| Field | Value |
|-------|-------|
| **Archivos** | `fiscal_agent/api/middleware/auth.py` (~100 líneas modificadas) |
| **Líneas estimadas** | ~100 modificadas |
| **Dependencias** | B.1 |
| **Duración** | Medium |

**Descripción**: Refactor `AuthMiddleware.dispatch()` para implementar Chain of Responsibility con dispatch por prefijo:

1. Extraer `raw_token` del header (Bearer preferred, X-API-Key fallback) — lógica existing
2. Si token empieza con `fa_` → `ApiKeyExtractor.handle(raw_token)` (flujo existente, refactorizado a método)
3. Si NO empieza con `fa_` → `ClerkJWTExtractor.handle(raw_token, request, redis)`
4. Si ambos fallan → 401 `UNAUTHORIZED`

Refactorizar el bloque actual (líneas 70-157) como `ApiKeyExtractor.handle(raw_token, request, store)` — separar la lógica de API Key en un método o clase independiente. El dispatch central queda limpio.

**Request.state contract**: Ambos extractores deben inyectar `auth_method`, `scopes`, `tenant_id`, `rate_limit_config`. Clerk NO inyecta `developer`, `app`, `api_key`.

**Actualizar `_PUBLIC_PATHS`**: Agregar rutas de Clerk webhooks (cuando se agreguen, por ahora mantener las existentes).

**Criterios de test**:
- Token `fa_*` → pasa por ApiKeyExtractor (backward compatible)
- Token JWT Clerk → pasa por ClerkJWTExtractor
- Token inválido (no fa_, no JWT válido) → 401 `UNAUTHORIZED`
- Missing auth header → 401
- Wrong scheme (Basic, Digest) → 401
- `request.state` tiene estructura correcta para ambos métodos

**Commit unit**: `feat(backend): refactor AuthMiddleware with dual extractor dispatch`

---

### B.3 — Modificar `fiscal_agent/config.py` — agregar Clerk settings

| Field | Value |
|-------|-------|
| **Archivos** | `fiscal_agent/config.py` (~5 líneas modificadas) |
| **Líneas estimadas** | ~5 modificadas |
| **Dependencias** | B.1 |
| **Duración** | Small |

**Descripción**: Agregar `CLERK_SECRET_KEY` y `CLERK_DOMAIN` como campos opcionales en `AppSettings` (o crear sub-modelo `ClerkConfig`). Usar `Field(default='', alias='CLERK_SECRET_KEY')` y `Field(default='', alias='CLERK_DOMAIN')`. Si están vacíos, ClerkJWTExtractor saltea validación (devuelve 401 con mensaje de config faltante).

**Criterios de test**:
- `get_settings().clerk_secret_key` existe (default '')
- `get_settings().clerk_domain` existe (default '')
- Config cargada correctamente desde env vars

**Commit unit**: `feat(backend): add Clerk settings to config`

---

### B.4 — Modificar `fiscal_agent/api/middleware/__init__.py` — exportar ClerkJWTExtractor

| Field | Value |
|-------|-------|
| **Archivos** | `fiscal_agent/api/middleware/__init__.py` (~2 líneas modificadas) |
| **Líneas estimadas** | ~2 modificadas |
| **Dependencias** | B.2 |
| **Duración** | Small |

**Descripción**: Agregar `ClerkJWTExtractor` al `__all__` y al import desde `clerk`.

**Criterios de test**:
- `from fiscal_agent.api.middleware import ClerkJWTExtractor` funciona

**Commit unit**: same as B.3 (include in same commit or B.2)

---

### B.5 — Agregar endpoints de API Keys en admin.py

| Field | Value |
|-------|-------|
| **Archivos** | `fiscal_agent/api/routes/admin.py` (~40 líneas modificadas) |
| **Líneas estimadas** | ~40 modificadas |
| **Dependencias** | B.2, D.4 (store methods) |
| **Duración** | Medium |

**Descripción**: Agregar 3 endpoints en `admin.py`:

1. **`POST /v1/admin/api-keys`** (status 201): Crea API key para tenant autenticado. Lee `request.state.tenant_id`. Valida que `request.state.auth_method == 'clerk_jwt'` (solo usuarios Clerk pueden crear keys desde profile). Request body opcional: `{"scopes": [...]}`. Valida que scopes solicitados sean subset de `plan.scopes`. Si excede → 403 `SCOPE_EXCEEDS_PLAN`. Retorna `{key_preview, full_key, warning}`.

2. **`GET /v1/admin/api-keys`**: Lista keys activas del tenant. Retorna solo `key_preview, created_at, scopes, is_active`. Full key NUNCA se retorna.

3. **`DELETE /v1/admin/api-keys/{key_id}`**: Revoca key. Verifica que pertenezca al tenant autenticado. Si no existe o no pertenece → 404.

**Criterios de test**:
- Crear key con scopes default del plan → key creada con plan_scopes
- Crear key con subset de scopes → key creada con esos scopes
- Crear key con scope que excede plan → 403 `SCOPE_EXCEEDS_PLAN`
- Listar keys → solo key_preview, no full key
- Revocar key → is_active=false, no aparece en list
- Cross-tenant revoke → 404

**Commit unit**: `feat(backend): add tenant-scoped API key management endpoints`

---

### B.6 — Verificar server.py middleware chain y docker-compose

| Field | Value |
|-------|-------|
| **Archivos** | `fiscal_agent/api/server.py` (~2 líneas verificadas/modificadas), `docker-compose.prod.yml` (~2 líneas) |
| **Líneas estimadas** | ~2 modificadas |
| **Dependencias** | B.2 |
| **Duración** | Small |

**Descripción**: 
- **server.py**: Verificar que el middleware chain sigue siendo `CORS → Metrics → AuthMiddleware → TenantContext → RateLimit → Routes`. No debería requerir cambios (el dispatch es interno de AuthMiddleware), pero confirmar que no hay imports rotos.
- **docker-compose.prod.yml (o docker-compose.yml)**: Agregar variable `CLERK_SECRET_KEY` y `CLERK_DOMAIN` al servicio de fiscal-agent-api.

**Criterios de test**:
- Servidor arranca sin errores de import
- Middleware chain respeta el orden

**Commit unit**: `chore(backend): add Clerk env vars to docker-compose`

---

## Sprint C — Conversaciones a Redis

**Goal**: Move conversation storage from browser localStorage to Redis backend, enabling multi-device access.

### C.1 — Crear `fiscal_agent/api/store.py` — ConversationStore methods

| Field | Value |
|-------|-------|
| **Archivos** | `fiscal_agent/api/store.py` (~40 líneas modificadas) |
| **Líneas estimadas** | ~40 modificadas |
| **Dependencias** | B.2 (para request.state.tenant_id) |
| **Duración** | Medium |

**Descripción**: Agregar métodos a `RedisStore` (o nueva clase `ConversationStore`) para CRUD de conversaciones:

```python
_KEY_CONV = 'tenant:{tid}:conv:{cid}'       # Hash
_KEY_CONV_ALL = 'tenant:{tid}:conv:all'       # Set
_CONV_TTL = 7776000  # 90 days

async def save_conversation(self, tenant_id, conversation_id, messages) -> str
async def get_conversation(self, tenant_id, conversation_id) -> dict | None
async def list_conversations(self, tenant_id) -> list[dict]
async def delete_conversation(self, tenant_id, conversation_id) -> None
async def create_personal_tenant(self, user_id: str) -> Tenant
```

- `save_conversation`: Si `conversation_id` existe → `HSET` + `EXPIRE` (update). Si no → generar nuevo ID, `HSET` + `EXPIRE` + `SADD tenant:{tid}:conv:all {id}`.
- `get_conversation`: `HGETALL` + `EXPIRE` (touch TTL). Si no existe → None.
- `list_conversations`: `SMEMBERS tenant:{tid}:conv:all` → para cada ID: `HGETALL`. Retornar sorted por `updated_at` desc.
- `delete_conversation`: `DEL tenant:{tid}:conv:{cid}` + `SREM tenant:{tid}:conv:all {cid}`.

Detalles del hash:
```
Key:   tenant:{tenant_id}:conv:{conv_id}
Fields: id, title, messages (JSON), created_at, updated_at
TTL:   7776000s
```

**Criterios de test**:
- `save_conversation` sin conv_id → crea nuevo con ID generado
- `save_conversation` con conv_id existente → actualiza en-place
- `get_conversation` existente → retorna hash completo
- `get_conversation` inexistente → None
- `list_conversations` → lista ordenada por updated_at desc
- `delete_conversation` → DEL + SREM exitosos
- TTL se refresca en update y get

**Commit unit**: `feat(backend): add ConversationStore methods for Redis CRUD`

---

### C.2 — Crear router `conversations.py` con endpoints CRUD

| Field | Value |
|-------|-------|
| **Archivos** | `fiscal_agent/api/routes/chat/conversations.py` (nuevo, ~100 líneas), `fiscal_agent/api/routes/chat/__init__.py` (nuevo, ~3 líneas) |
| **Líneas estimadas** | ~103 nuevas |
| **Dependencias** | C.1 |
| **Duración** | Medium |

**Descripción**: Crear package `fiscal_agent/api/routes/chat/` con `__init__.py` que exporte `conversations_router`. Mover el import actual de `chat.py` a este package o mantener ambos routers separados.

Endpoints:

1. **`POST /v1/chat/conversations/save`**: Body `{conversation_id?: string, messages: array}`. Lee `request.state.tenant_id`. Si hay conv_id → update, si no → create. Retorna `{conversation_id}`.

2. **`GET /v1/chat/conversations`**: Lista conversaciones del tenant. Retorna `[{conversation_id, title, message_count, updated_at}]` sorted desc.

3. **`GET /v1/chat/conversations/{id}`**: Retorna conversación completa. Si no existe → 404 `CONVERSATION_NOT_FOUND`.

4. **`DELETE /v1/chat/conversations/{id}`**: Elimina. Si no existe → 204 de todas formas (idempotente).

Todos los endpoints requieren `request.state.tenant_id` (inyectado por AuthMiddleware).

**Criterios de test**:
- POST save (new) → 201 con conversation_id
- POST save (update) → 200 con mismo conversation_id
- GET list → array de summaries
- GET {id} → conversación completa
- GET {id} inexistente → 404
- DELETE {id} → 204
- Cross-tenant isolation (key prefix garantiza)

**Commit unit**: `feat(backend): add conversations CRUD router with Redis persistence`

---

### C.3 — Integrar conversations router en server.py

| Field | Value |
|-------|-------|
| **Archivos** | `fiscal_agent/api/server.py` (~3 líneas modificadas), `fiscal_agent/api/routes/chat.py` (verificar compatibilidad) |
| **Líneas estimadas** | ~3 modificadas |
| **Dependencias** | C.2 |
| **Duración** | Small |

**Descripción**: 
- Mover `chat.py` a `chat/__init__.py` y `chat/message.py` para organización (o mantener ambos routers separados). Opción recomendada: mantener `chat.py` como está, importar `conversations_router` de `chat.conversations` e incluirlo. 
- En `server.py`, agregar `app.include_router(conversations_router, tags=['chat'])` (mismo tag que chat).

**Criterios de test**:
- `GET /v1/chat/conversations` responde 200 (o 401 si no auth)
- Server arranca sin errores

**Commit unit**: `feat(backend): register conversations router in server.py`

---

### C.4 — Modificar useChat.js — migración progresiva localStorage → backend

| Field | Value |
|-------|-------|
| **Archivos** | `frontend/IdeaDashboardai-chatbot-interface-template/hooks/useChat.js` (~80 líneas modificadas, ya contadas en A.6) |
| **Líneas estimadas** | ~0 nuevas (refinamiento de A.6) |
| **Dependencias** | A.6, C.2 |
| **Duración** | Small (QA sobre A.6) |

**Descripción**: Verificar que la migración progresiva implementada en A.6 cumple con:
1. Al montar con `isSignedIn=true`, llama `loadConversations()` y `migrateLocalStorage()`
2. `migrateLocalStorage()` chequea flag `fa_conversations_migrated` en localStorage
3. Si existen `fa_conversations`, sube una por una a `POST /v1/chat/conversations/save`
4. Si todas se suben exitosamente, limpia localStorage y setea flag
5. Si alguna falla, mantiene localStorage como fallback (no-bloqueante)
6. No hay flag → reintenta en próximo login

Esta tarea valida y corrige si A.6 no implementó correctamente la migración.

**Criterios de test**:
- Auth hook monta → fetch conversations desde API
- localStorage data migrada al backend tras login exitoso
- Si backend offline, localStorage permanece intacto
- Usuario no bloqueado por fallo de migración

**Commit unit**: `fix(chat): ensure localStorage migration is non-blocking and complete`

---

## Sprint D — Profile UI + API Keys

**Goal**: Build `/profile` page with API key management, tenant settings, and navigation integration.

### D.1 — Crear layout de profile con sidebar tabs

| Field | Value |
|-------|-------|
| **Archivos** | `frontend/IdeaDashboardai-chatbot-interface-template/app/profile/layout.tsx` (nuevo, ~15 líneas) |
| **Líneas estimadas** | ~15 nuevas |
| **Dependencias** | A.3 (middleware protege /profile) |
| **Duración** | Small |

**Descripción**: Crear layout para `/profile/*` con sidebar de navegación vertical + main content area. Usar shadcn `navigation-menu` o `NavLink` simple. Tabs: "Profile" (overview), "API Keys", "Settings". Active state highlight. Responsivo: sidebar → top tabs en mobile (<768px).

**Criterios de test**:
- `/profile` renderiza layout con sidebar
- Sidebar muestra 3 tabs (Profile, API Keys, Settings)
- Click en tab cambia la ruta (o section via state)
- Mobile: sidebar colapsa a top tabs

**Commit unit**: `feat(profile): add profile layout with sidebar navigation`

---

### D.2 — Crear `useApiKeys` hook

| Field | Value |
|-------|-------|
| **Archivos** | `frontend/IdeaDashboardai-chatbot-interface-template/hooks/useApiKeys.js` (nuevo, ~40 líneas) |
| **Líneas estimadas** | ~40 nuevas |
| **Dependencias** | A.5 (api-client con token), B.5 (endpoints backend) |
| **Duración** | Small |

**Descripción**: Hook personalizado que encapsula CRUD de API keys:
- `listKeys()` → `GET /v1/admin/api-keys` con token de `useAuth().getToken()`
- `createKey(scopes?)` → `POST /v1/admin/api-keys` con token
- `revokeKey(keyId)` → `DELETE /v1/admin/api-keys/{keyId}`
- State: `keys[], loading, error`

**Criterios de test**:
- Hook retorna keys del tenant
- createKey retorna full_key + key_preview
- revokeKey marca como inactiva

**Commit unit**: `feat(profile): add useApiKeys hook for API key CRUD`

---

### D.3 — Crear componente `ApiKeysList`

| Field | Value |
|-------|-------|
| **Archivos** | `frontend/IdeaDashboardai-chatbot-interface-template/components/profile/ApiKeysList.tsx` (nuevo, ~50 líneas) |
| **Líneas estimadas** | ~50 nuevas |
| **Dependencias** | D.2 |
| **Duración** | Small |

**Descripción**: Tabla de API keys usando shadcn `Table`. Columnas: key_preview, scopes (badges), created_at, actions (revoke button destructivo). Empty state: "No API keys yet" con CTA "Create your first key". Loading state: Skeleton table (3 rows). Error state: mensaje con retry button. Revoke button abre `AlertDialog` de confirmación.

**Criterios de test**:
- Tabla muestra keys del hook
- Empty state se renderiza sin keys
- Revoke button abre confirmación
- Tras revoke, key desaparece de la lista
- Loading muestra skeleton
- Error muestra mensaje + retry

**Commit unit**: `feat(profile): add ApiKeysList component with table and empty state`

---

### D.4 — Crear componente `ApiKeyCreateDialog`

| Field | Value |
|-------|-------|
| **Archivos** | `frontend/IdeaDashboardai-chatbot-interface-template/components/profile/ApiKeyCreateDialog.tsx` (nuevo, ~40 líneas) |
| **Líneas estimadas** | ~40 nuevas |
| **Dependencias** | D.2 |
| **Duración** | Small |

**Descripción**: Modal de creación de API key usando shadcn `Dialog`. Formulario con checkboxes de scopes (cargados del plan del tenant). Submit button con spinner. Al crear exitosamente, mostrar full key en un `Alert` con advertencia "Guardá esta key — no se mostrará nuevamente". Botón "Copy to clipboard". Cerrar refresca la lista de keys.

**Criterios de test**:
- Dialog se abre desde botón "Create API Key"
- Scopes checkboxes reflejan plan del tenant
- Submit exitoso muestra full key una vez
- Copy button copia al portapapeles
- Error de scope muestra inline error text
- Submit button se deshabilita durante creación

**Commit unit**: `feat(profile): add ApiKeyCreateDialog with scope selection and one-time key display`

---

### D.5 — Crear `SettingsPanel` y Profile overview page

| Field | Value |
|-------|-------|
| **Archivos** | `frontend/IdeaDashboardai-chatbot-interface-template/components/profile/SettingsPanel.tsx` (nuevo, ~40 líneas), `frontend/IdeaDashboardai-chatbot-interface-template/app/profile/settings/page.tsx` (nuevo, ~15 líneas), `frontend/IdeaDashboardai-chatbot-interface-template/app/profile/page.tsx` (nuevo, ~25 líneas) |
| **Líneas estimadas** | ~80 nuevas |
| **Dependencias** | A.5 (api-client para GET /v1/admin/me) |
| **Duración** | Small |

**Descripción**:

**SettingsPanel**: Tarjeta con información del tenant leída desde `GET /v1/admin/me` (o `useUser()` de Clerk para datos personales). Read-only fields: tenant_id, name, plan badge (shadcn `Badge` variant="secondary"). Loading: Skeleton form. Error: mensaje con retry.

**Profile overview page** (`/profile/page.tsx`): Tarjeta con avatar, nombre, email (desde Clerk `useUser()`), tenant name, plan badge. Read-only.

**Settings page** (`/profile/settings/page.tsx`): Renderiza `<SettingsPanel />`.

**Criterios de test**:
- Profile muestra datos del usuario Clerk
- Settings muestra tenant info y plan badge
- Loading states para todo
- Error states con retry

**Commit unit**: `feat(profile): add SettingsPanel and profile overview page`

---

### D.6 — Integrar profile en navegación del Chat UI

| Field | Value |
|-------|-------|
| **Archivos** | `frontend/IdeaDashboardai-chatbot-interface-template/components/Sidebar.jsx` (~10 líneas modificadas), `frontend/IdeaDashboardai-chatbot-interface-template/app/profile/api-keys/page.tsx` (nuevo, ~25 líneas) |
| **Líneas estimadas** | ~35 modificadas/nuevas |
| **Dependencias** | D.1, D.3, D.4 |
| **Duración** | Small |

**Descripción**: 
- **Sidebar.jsx**: El avatar + nombre del usuario en la parte inferior debe ser clickeable y navegar a `/profile`. Reemplazar el `<div>` estático con un `<Link href="/profile">`.
- **API Keys page** (`/profile/api-keys/page.tsx`): Renderiza `<ApiKeysList />` y maneja el estado de create dialog (botón "Create API Key" que abre `<ApiKeyCreateDialog />`).
- El sidebar de profile ya existe del layout (D.1).

**Criterios de test**:
- Click en avatar del Sidebar → navega a `/profile`
- `/profile/api-keys` muestra tabla + create button

**Commit unit**: `feat(profile): integrate profile navigation in sidebar and add API keys page`

---

## Review Workload Forecast

### Estimación total de líneas

| Sprint | Nuevas | Modificadas | Total |
|--------|--------|-------------|-------|
| **Sprint A** — Clerk en Chat UI | 48 | 135 | **183** |
| **Sprint B** — Backend Clerk JWT | 122 | 147 | **269** |
| **Sprint C** — Conversaciones a Redis | 103 | 43 | **146** |
| **Sprint D** — Profile UI + API Keys | 250 | 10 | **260** |
| **Total** | **523** | **335** | **~858** |

### Budget Check contra 400 líneas

| Métrica | Valor |
|---------|-------|
| Total líneas cambiadas (nuevas + modificadas) | ~858 |
| Umbral de revisión saludable | 400 |
| **Exceso sobre umbral** | **~458 (114% over)** |
| Mínimo commit unitario (Sprint A más pequeño) | ~53 (A.1 + A.2 + A.3) |
| Máximo commit unitario (B.2 más grande) | ~100 |

### Risk Assessment

| Riesgo | Nivel | Motivo | Mitigación |
|--------|-------|--------|------------|
| **Tamaño total** | 🔴 Alto | 858 líneas excede ampliamente las 400 de revisión saludable | Los sprints son independientes y pueden PR separados |
| **Dependencias entre sprints** | 🟡 Medio | B depende de A (para integración), C depende de B (tenant_id en state) | Pero B puede mergearse sin frontend desplegado |
| **Migración datos** | 🟢 Bajo | localStorage → Redis es no-bloqueante | Fallback mantiene datos antiguos |
| **Backward compat** | 🟢 Bajo | API Key sigue funcionando exactamente igual | Dual extractor con dispatch por prefijo |

### Recomendación

**NO es viable como Single PR.** Aunque el diseño está pensado para integrarse progresivamente, ~858 líneas es demasiado para una revisión efectiva.

**Estrategia recomendada**: 3 PRs encadenados + 1 PR opcional:

1. **PR #1 — Sprint A + B (backend + frontend auth)**: ~450 líneas. Clerk en frontend + Clerk JWT en backend. Este PR tiene más riesgo de conflictos porque toca auth. Justifica `size:exception` si se revisa con atención al middleware chain. Prioridad: alta.

2. **PR #2 — Sprint C (conversaciones a Redis)**: ~146 líneas. Backend CRUD + integración useChat. Bajo riesgo, bien aislado. Se mergea después de PR #1.

3. **PR #3 — Sprint D (Profile UI + API Keys)**: ~260 líneas. Frontend components + backend endpoints. Independiente de PR #2. Se mergea después de PR #1 (necesita endpoints B.5).

**Si se opta por Single PR con `size:exception`**, documentar:
- El feature no es funcional hasta que todos los sprints estén completos (no se puede deployar parcialmente sin romper auth)
- Los reviewers deben enfocarse en: middleware dispatch (B.2), token injection (A.5), JWKS caching (B.1)
- Los componentes UI (Sprint D) son estándar shadcn/ui — revisión rápida

**Veredicto**: 🟡 **Recomendado: 3 PRs encadenados**. Aceptar `size:exception` solo si se acuerda revisión enfocada con checklist por sprint.
