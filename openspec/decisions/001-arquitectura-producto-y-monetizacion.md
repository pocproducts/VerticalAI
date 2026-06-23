# ADR-001: Arquitectura de Producto y Monetización

> **Fecha**: 2026-06-17
> **Contexto**: Cierre de sesión SDD con 6/9 issues resueltos + frontend Pulse analizado + modelo de negocio inicial.

---

## Decisiones

### 1. Un solo repo, dos modos (single-tenant / multi-tenant)

**Decisión**: No duplicar el repo. El monolito actual es single-tenant por defecto. Multi-tenant se desarrolla en `feature/tenant` y se mergea a `main` como código additivo. Sin Clerk configurado, el sistema arranca como hoy.

**Racional**: Evita divergencia de codebases. El tenant es un feature toggle via config.

**Archivo**: `fiscal_agent/billing/tiers.py`, `PlanTier` enum, `calcular_costo()`

### 2. Planes de negocio en billing/tiers.py

**Decisión**: Tres tiers definidos como enum + reglas de pricing:
- **Estudio** — $99/mes flat, 50 contribuyentes, browser incluido
- **Freelance** — $0.05/seg browser, 10 contribuyentes, sin flat
- **Enterprise** — $299/mes, ilimitado, $0.02/seg browser

**Racional**: Semilla para validar hipótesis de producto. Los precios son placeholder ajustable.

**Moneda**: USD.

### 3. Frontends separados, un backend

**Decisión**: El backend vive en un Docker Compose (FastAPI + Engram + Redis). Los frontends (Pulse, Chat UI, Landing) son repos separados que apuntan al mismo backend vía HTTP.

**Racional**: Separación de despliegues, equipos y ciclos de vida. Cada frontend escala independientemente.

### 4. Clerk para multi-tenant

**Decisión**: Usar Clerk como proveedor de auth/orgs. Webhooks `organization.created` → crean tenant en Postgres. Middleware JWT verifica org_id en cada request.

**Racional**: Clerk resuelve auth, orgs, invites, sesiones. El backend solo recibe webhooks y JWTs verificados.

**Desafío real**: Aislación de credenciales ARCA por tenant (cada estudio tiene su CUIT, certificado y token).

### 5. Estrategia de rollout

| Fase | Contenido | Para quién |
|------|-----------|-----------|
| **Fase 0** | Backend + Engram + Redis + Chat UI (Docker) | Estudio 1 |
| **Fase 1** | + Clerk + Postgres + Pulse dashboard | Estudios 1..N |
| **Fase 2** | + Onboarding automático + Billing activo | Escalar comercial |

### 6. Pipeline de refactor completado

Issues resueltos: #1, #2, #3, #4, #5, #6, #7, #9 (8/9).
Issue pendiente: #8 (Auth desconectada).

Cambios archivados:
- `task-system-decoupling`
- `pipeline-service-extraction`
- `browser-task-factory`
- `memory-client-cleanup`

---

## Archivos creados/modificados esta sesión

- `fiscal_agent/billing/__init__.py` — Módulo de billing
- `fiscal_agent/billing/tiers.py` — PlanTier + reglas de pricing
- `.consultorias/04.analisis-frontend-dashboard-pulse.md` — Catálogo de 24 endpoints de Pulse
- `openspec/changes/archive/2026-06-17-*` — 4 cambios SDD archivados
- `openspec/specs/*` — 4 dominios de specs actualizados/creados (browser-task, base-task, arca-ws-task, pipeline)
