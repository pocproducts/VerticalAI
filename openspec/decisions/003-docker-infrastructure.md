# ADR-003: Docker Infrastructure — Dev + Production

## Status

Accepted — Implementado.

## Context

Fiscal Agent necesita correr en dos entornos distintos:

1. **Desarrollo local**: el dev necesita hot-reload, todos los servicios, puertos expuestos para debug, acceso directo a cada frontend.
2. **Producción (Plan Estudio)**: mínimo indispensable para el estudio contable. Un solo frontend (chat-ui), backend con healthcheck, base de datos caché y memoria. Sin dashboard ni landing page.

Además, el frontend Chat UI ahora usa **Clerk Auth**, que requiere `NEXT_PUBLIC_*` build args para las keys de publishable. Y el backend necesita `CLERK_SECRET_KEY`, `REDIS_URL` y `ARCA_PROXY_URL` como variables de entorno.

## Decision

Mantener **dos archivos docker-compose** separados:

### 1. Dev Stack (`docker-compose.yml`)

7 servicios — todo expuesto, pensado para desarrollo:

| Servicio | Puerto host | Puerto container | Perfil |
|----------|-------------|------------------|--------|
| frontend (chat-ui) | 3000 | 3002 | siempre |
| landing | 3002 | 3000 | siempre |
| dashboard | 3001 | 3000 | `full` |
| fiscal-agent | 8000 | 8000 | siempre |
| postgres | 5433 | 5432 | siempre |
| engram | 7437 | 7437 | siempre |
| redis | 6379 | 6379 | siempre |

### 2. Production Stack (`docker-compose.prod.yml`)

5 servicios — mínimo necesario para el plan Estudio. Red aislada `estudio-net`:

| Servicio | Expone | Aislado | Healthcheck |
|----------|--------|---------|-------------|
| chat-frontend | :80 → :3000 | estudio-net | no |
| fiscal-agent | interno | estudio-net | sí (30s) |
| postgres | interno | estudio-net | sí (10s) |
| engram | interno | estudio-net | sí |
| redis | interno | estudio-net | sí (10s) |

### Variables de entorno

- Frontend: `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` y `NEXT_PUBLIC_API_URL` como **build args** (Next.js las necesita en build time).
- Backend: `CLERK_SECRET_KEY`, `CLERK_DOMAIN`, `ARCA_PROXY_URL`, `REDIS_URL` desde el host.
- `.env` file para dev, env vars del entorno para prod.

### Volúmenes persistentes

- `postgres-data`, `engram-data`, `redis-data`, `pdf-output`
- Certificados ARCA montados como `:ro` en prod
- `clients.yaml` montado como `:ro` en prod

## Consequences

- **Positivo**: separación clara entre entornos. Prod no expone puertos innecesarios. Dev tiene todo accesible.
- **Positivo**: el dashboard (perfil `full`) no se levanta por defecto en dev, ahorrando recursos.
- **Negativo**: dos archivos para mantener sincronizados. Si se agrega un servicio, va en ambos.
- **Negativo**: los build args de Clerk obligan a rebuildear la imagen si cambia la key pública.

## Service Dependencies

```
dev:  frontend → fiscal-agent → redis
      landing (standalone)
      dashboard (perfil full) → fiscal-agent
      fiscal-agent → redis → engram → postgres

prod: chat-frontend → fiscal-agent → redis
      fiscal-agent → redis
      engram → postgres
```
