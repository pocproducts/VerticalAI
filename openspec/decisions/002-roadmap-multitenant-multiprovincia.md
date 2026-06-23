# ADR-002: Roadmap Multi-tenant + Multi-provincia

## Status

Draft — Propuesto para discusión.

## Context

El sistema Fiscal-Agent nació como solución single-tenant para un estudio contable de Córdoba (Estudio 1, plan Estudio). Tras la Fase 0 completada, surgen dos estudios interesados: **uno en Jujuy** y **uno en Buenos Aires**.

El stack actual tiene componentes nacionales (ARCA, Padrón A5, ctacte.cloud) que funcionan para cualquier provincia, pero la extracción IIBB está hardcodeada a Rentas Córdoba DGR.

## Problema

1. **Multi-provincia**: La DGR es provincial. Cada provincia tiene su propio portal, login y estructura de datos. El template `workflows/iibb.py` solo sirve para Córdoba.
2. **Multi-tenant**: El sistema asume un único estudio en `.env` (`ESTUDIO_CUIT`, `ESTUDIO_CLAVE_FISCAL`, certificados). No puede servir a dos estudios simultáneamente.

## Arquitectura target

```
                    ┌─────────────┐
                    │   Clerk     │  ← Auth + Orgs (Sprint 3)
                    └──────┬──────┘
                           │ JWT (org_id = tenant_id)
                           ▼
              ┌─────────────────────────┐
              │   API / MCP Middleware   │  ← Inyecta tenant context
              └────────────┬────────────┘
                           │
              ┌────────────┴────────────┐
              │                         │
     ┌────────▼────────┐     ┌─────────▼────────┐
     │  Tenant A        │     │  Tenant B         │
     │  (Córdoba)       │     │  (Jujuy)          │
     │  CUIT, clave,    │     │  CUIT, clave,     │
     │  certificados,   │     │  certificados,    │
     │  clients.yaml    │     │  clients.yaml     │
     └────────┬─────────┘     └─────────┬─────────┘
              │                         │
              └────────────┬────────────┘
                           │
              ┌────────────┴────────────┐
              │     ComposioBrowser     │
              │  (logueado como tenant) │
              └────────────┬────────────┘
                           │
              ┌────────────┴────────────┐
              │    IIBBRouter           │
              │  Córdoba → iibb/cba     │
              │  Jujuy   → iibb/juj     │
              │  Bs As   → iibb/ba      │
              └─────────────────────────┘
```

## Decisiones

### D1: Separar IIBB templates por provincia

Cada provincia tendrá su propio archivo de template en `fiscal_agent/browser/workflows/iibb/`:

| Provincia | Archivo | Portal |
|---|---|---|
| Córdoba | `iibb/cordoba.py` | rentascordoba.gob.ar |
| Jujuy | `iibb/jujuy.py` | DGR Jujuy |
| Buenos Aires | `iibb/buenos_aires.py` | ARBA / DGR Bs As |

### D2: IIBBRouter para selección dinámica

```python
class IIIBRouter:
    templates = {
        'CORDOBA': TEMPLATE_IIBB_CORDOBA,
        'JUJUY':   TEMPLATE_IIBB_JUJUY,
    }
    @classmethod
    def get(cls, provincia: str) -> str: ...
```

### D3: Tenant como entidad de primer nivel

Cada tenant tiene:
- `id`, `name`, `plan_tier`
- `cuit`, `clave_fiscal`
- `certificados` (paths)
- `clientes: list[ClientConfig]`
- `provincias: list[str]`

Almacenados en Redis vía `TenantStore` (ya existe `RedisStore` en admin).

### D4: API key → Tenant binding

El sistema de admin API keys ya existe (`POST /v1/admin/register`, keys). Se vincula cada API key a un `tenant_id`.

### D5: Clerk para auth multi-tenant

Clerk Organizations se usa como source of truth. Cada org = un tenant. Webhook `organization.created` → crea tenant en Redis.

## Roadmap

### Sprint 1: Provincia Router (1 semana)

| # | Task | Cambio |
|---|------|--------|
| 1.1 | Mover `workflows/iibb.py` → `workflows/iibb/cordoba.py` | Refactor, no cambia comportamiento |
| 1.2 | Crear `workflows/iibb/jujuy.py` con template DGR Jujuy | Nuevo |
| 1.3 | Crear `browser/iibb_router.py` | Selecciona template según provincia |
| 1.4 | Refactor `match_rentas_cordoba()` → `match_provincial_iibb(provincia)` | Genérico |
| 1.5 | Agregar campo `provincia` a `ClientConfig` | Modelo + clients.yaml |

### Sprint 2: Multi-tenant foundation (1.5 semanas)

| # | Task | Cambio |
|---|------|--------|
| 2.1 | Modelo `Tenant` + `TenantStore` | Redis |
| 2.2 | API key → tenant binding | `admin.py` |
| 2.3 | Migrar .env + clients.yaml existente a Tenant 1 | Migración one-time |
| 2.4 | TenantContext middleware | Cada request lleva tenant_id |
| 2.5 | Scoped browser sessions | ComposioBrowser usa credenciales del tenant |

### Sprint 3: Clerk Auth + Aislamiento (2 semanas)

| # | Task | Cambio |
|---|------|--------|
| 3.1 | Clerk webhooks (org.created → tenant) | Auth |
| 3.2 | JWT verification middleware | Seguridad |
| 3.3 | Scoped storage (PDFs por tenant) | Almacenamiento |
| 3.4 | Scoped API (cada tenant ve solo sus datos) | Queries |

### Sprint 4: Buenos Aires (2-3 días, cuando llegue)

| # | Task | Cambio |
|---|------|--------|
| 4.1 | Crear `workflows/iibb/buenos_aires.py` | Template ARBA |
| 4.2 | Agregar al router | 1 línea |

## Riesgos

| Riesgo | Probabilidad | Mitigación |
|--------|-------------|------------|
| DGR Jujuy no tiene portal web accesible | Media | Validar con anticipación; si no hay portal, el template reporta "no disponible" |
| Clerk webhooks latencia | Baja | Cache local del tenant en Redis |
| Migración de tenants pierde data | Baja | El estudio actual (Córdoba) se migra como Tenant 1 con script ad-hoc |
| Sprint 2 y 3 solapan | Media | Sprint 2 termina con API keys funcionales + Redis store. Sprint 3 agrega Clerk sin romper API keys |

## Archivos afectados (total estimado)

- `fiscal_agent/browser/workflows/iibb.py` → mover a `iibb/cordoba.py`
- `fiscal_agent/browser/workflows/iibb/jujuy.py` → nuevo
- `fiscal_agent/browser/workflows/iibb/__init__.py` → nuevo
- `fiscal_agent/browser/iibb_router.py` → nuevo
- `fiscal_agent/browser/factory.py` → usar router
- `fiscal_agent/browser/composio.py` → pasar provincia
- `fiscal_agent/matching.py` → refactor
- `fiscal_agent/models.py` → Tenant, ClientConfig.provincia
- `fiscal_agent/api/store.py` → TenantStore
- `fiscal_agent/api/middleware/tenant.py` → nuevo
- `fiscal_agent/api/routes/admin.py` → binding key→tenant
- `fiscal_agent/config.py` → multi-tenant config
- `fiscal_agent/cli.py` → tenant-aware
