# Proposal: Clerk Frontend Auth

## Intent

Agregar autenticación real (Clerk) al Chat UI, validación de Clerk JWT en el backend, migración de conversaciones a Redis, y UI de gestión de cuenta (profile, API keys, settings). Hoy el chat funciona sin auth — solo se envía una API key hardcodeada del `.env`. Sin este cambio no hay aislamiento multi-tenant ni sesiones de usuario reales.

## Scope

### In Scope
- Clerk (`@clerk/nextjs`) en Chat UI: login Google/email, route protection
- JWT de Clerk como Bearer token en llamadas API
- Backend: validación de Clerk JWT via JWKS, mapeo `org_id` → Tenant
- Endpoints `GET/POST /v1/admin/api-keys` desde profile
- Conversaciones movidas de localStorage a Redis (multi-dispositivo)
- Profile UI, API Keys management, settings básicos

### Out of Scope
- Landing page o System Dashboard — solo Chat UI
- RBAC avanzado, equipos, invitaciones
- Webhooks de Clerk para sync de usuarios

## Capabilities

### New
- `clerk-auth`: Login/logout con Clerk, route protection, JWT en requests
- `api-key-management`: UI y backend endpoints para crear/listar/revocar keys
- `conversation-storage`: Backend CRUD de conversaciones en Redis

### Modified
- `chat-frontend`: package.json (+@clerk/nextjs), layout (+ClerkProvider), middleware.ts
- `api-client.js`: Token dinámico desde Clerk session en vez de env var
- `useChat.js`: Source de verdad cambia de localStorage a API
- `AuthMiddleware`: Nuevo ClerkJWTExtractor conviviendo con API Key existente
- `admin.py`: Nuevos endpoints api-keys + tenant info
- `docker-compose.prod.yml`: Variable CLERK_SECRET_KEY

## Approach

**Sprint A — Clerk en Chat UI.** Agregar `@clerk/nextjs` a package.json. Envolver layout con `<ClerkProvider>`. Crear `middleware.ts` protegiendo rutas. Componentes `SignIn`/`SignUp` con shadcn/ui. `useChat` lee token de `useAuth()` y lo pasa a `api-client.js`.

**Sprint B — Backend acepta Clerk JWT.** En `AuthMiddleware`, nuevo extractor que descarga JWKS de Clerk, verifica el JWT, extrae `org_id` y resuelve `TenantStore.get(org_id)`. Convive con el extractor de API Key actual. Nuevos endpoints `GET /v1/admin/api-keys` y `POST /v1/admin/api-keys` (desde tenant context).

**Sprint C — Conversaciones a Redis.** Backend: router `chat/conversations.py` con CRUD en Redis (hash por tenant). `useChat` migra de localStorage a `GET/POST/DELETE /v1/chat/conversations`. Migración progresiva: si hay conversaciones locales, se suben al backend al iniciar sesión.

**Sprint D — Profile UI + API Keys.** Nueva ruta `/profile` en el frontend. Componentes: `ProfilePage`, `ApiKeysList`, `ApiKeyCreateDialog`, `SettingsPanel`. Reutilizan shadcn/ui existente (Dialog, Table, Button, Input). Datos desde `GET /v1/admin/me` y los nuevos endpoints de keys.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `frontend/.../package.json` | Modified | +@clerk/nextjs, @clerk/themes |
| `frontend/.../app/layout.tsx` | Modified | +ClerkProvider wrapper |
| `frontend/.../app/middleware.ts` | New | Route protection |
| `frontend/.../app/(auth)/` | New | Sign-in / Sign-up pages |
| `frontend/.../app/profile/` | New | Profile + API Keys + Settings |
| `frontend/.../hooks/useChat.js` | Modified | Backend CRUD replaces localStorage |
| `frontend/.../lib/api-client.js` | Modified | Dynamic token from Clerk |
| `frontend/.../components/AIAssistantUI.jsx` | Modified | Auth-aware sidebar header |
| `fiscal_agent/api/middleware/auth.py` | Modified | +ClerkJWTExtractor |
| `fiscal_agent/api/routes/admin.py` | Modified | +api-keys endpoints |
| `fiscal_agent/api/routes/chat/` | Modified | +conversations CRUD router |
| `docker-compose.prod.yml` | Modified | +CLERK_SECRET_KEY env |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Clerk JWKS fetch latency en cada request | Medium | Cachear JWKS en Redis con TTL 1h |
| Migración de localStorage a Redis pierde datos | Low | Upload progresivo al login, mantener localStorage como fallback 7 días |
| Convivencia Clerk JWT + API Key confusa | Low | Namespace de scopes: `clerk:role` vs `api:scope`, logging diferenciado |

## Rollback Plan

1. Revertir frontend: `git revert` commits de Clerk, middleware, profile pages
2. Revertir backend: remover ClerkJWTExtractor, restaurar auth.py
3. Conversaciones en Redis persisten — borrar keys de tenant si es necesario
4. Frontend vuelve a API key hardcodeada del `.env`

## Success Criteria

- [ ] Usuario loguea con Google/email via Clerk
- [ ] Chat UI redirige a sign-in si no hay sesión
- [ ] Cada request al backend incluye Clerk JWT válido
- [ ] Backend acepta Clerk JWT y resuelve tenant correcto
- [ ] API Key auth sigue funcionando (backward compatible)
- [ ] Conversaciones persisten entre dispositivos (Redis)
- [ ] Usuario puede crear/ver API keys desde /profile
- [ ] Profile muestra datos del tenant
