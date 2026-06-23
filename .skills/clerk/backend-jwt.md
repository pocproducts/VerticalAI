---
title: Clerk Backend JWT Validation
agent: sdd-apply, gentle-orchestrator
description: Backend FastAPI — ClerkJWTExtractor, JWKS caching, tenant resolution
trigger: validar JWT Clerk, backend auth, extractor, JWKS, dual dispatch
---

# Clerk Backend — JWT Validation

## Arquitectura: Dual Extractor Dispatch

El `AuthMiddleware` usa Chain of Responsibility con dispatch por prefijo:

```
request.headers.Authorization (Bearer)
    │
    ├─ Token empieza con "fa_" → ApiKeyExtractor (legacy)
    │
    └─ Otro token → ClerkJWTExtractor
```

Ambos convergen en `request.state`:
```python
request.state.auth_method = 'clerk_jwt' | 'api_key'
request.state.tenant_id    # org_id o user_{sub[:12]}
request.state.scopes       # del plan
request.state.rate_limit_config
```

## ClerkJWTExtractor

Path: `fiscal_agent/api/middleware/clerk.py`

### Flujo

1. **Extraer token** del header `Authorization: Bearer <jwt>`
2. **Fetch JWKS** desde `https://{clerk_domain}.clerk.accounts.dev/.well-known/jwks.json`
3. **Cachear en Redis** key `jwks:clerk` con TTL 3600s
4. **Verificar JWT**: kid → JWK → RS256 verify → exp/iat/audience
5. **Extraer org_id** (`request.state.org_id`) del claim `org_id`
6. **Resolver tenant**:
   - Si hay `org_id` → `TenantStore.get(org_id)` — si no existe → 401 `TENANT_NOT_FOUND`
   - Si NO hay `org_id` → crear tenant personal `user_{sub[:12]}` con plan `free`
7. **Inyectar request.state** con auth_method, tenant_id, scopes, rate_limit

### JWKS Caching

```python
async def _get_jwks(self, redis: Redis) -> dict | None:
    cached = await redis.get('jwks:clerk')
    if cached:
        return json.loads(cached)    # cache hit
    
    url = f'https://{settings.clerk_domain}.clerk.accounts.dev/.well-known/jwks.json'
    async with httpx.AsyncClient() as client:
        resp = await client.get(url)
        jwks = resp.json()
    
    await redis.setex('jwks:clerk', 3600, json.dumps(jwks))
    return jwks
```

### Tenant Personal (sin org)

```python
# ClerkJWTExtractor.handle()
org_id = payload.get('org_id')
sub = payload['sub']

if org_id:
    tenant = await store.get_tenant(org_id)
    if not tenant:
        raise HTTPException(401, 'TENANT_NOT_FOUND')
else:
    personal_tid = f"user_{sub[:12]}"
    tenant = await store.get_tenant(personal_tid)
    if not tenant:
        tenant = await store.create_personal_tenant(sub[:12])
    org_id = personal_tid
```

## Config

```python
# fiscal_agent/config.py
class AppSettings(BaseSettings):
    clerk_secret_key: str = Field(default='', alias='CLERK_SECRET_KEY')
    clerk_domain: str = Field(default='', alias='CLERK_DOMAIN')
```

Si están vacíos → ClerkJWTExtractor salta validación y devuelve 401.

## Dependencias

```toml
# pyproject.toml
dependencies = [
    "pyjwt>=2.8.0",
    "cryptography>=41.0.0",
    "httpx>=0.27.0",
]
```

## Docker Compose

```yaml
services:
  fiscal-agent:
    environment:
      - CLERK_SECRET_KEY=${CLERK_SECRET_KEY-}
      - CLERK_DOMAIN=${CLERK_DOMAIN-}
```
