# System Dashboard Specification

## Purpose

Dashboard de monitoreo y control del sistema Fiscal Agent. Muestra el estado en vivo de la infraestructura, métricas de pipeline runs, activity feed, errores, servicios, y más. Consume los endpoints del backend `system-monitoring`.

## Dependencia

Este frontend depende del backend REST API (`/v1/system/*`, `/v1/health`). Sin backend no hay datos reales. La base del testing sigue siendo la consola/CLI.

## Stack

| Capa | Tecnología |
|------|-----------|
| Framework | Next.js 16 (App Router) |
| UI | React 19, TypeScript, Tailwind CSS 4, shadcn/ui (Radix UI primitives) |
| Gráficos | Recharts (vía `chart.tsx`) |
| API Client | Cliente tipado propio (`lib/api-client.ts`) |
| State | Hook `useSystemData` con fetch + loading/error |

## Layout

El dashboard tiene 3 paneles:

```
┌─────────────┬──────────────────────────┬──────────────┐
│ AppSidebar  │     MainContent          │  RightPanel  │
│             │  (switch según sección)  │  (activity)  │
│             │                          │              │
│ navigation  │  overview / incidents /  │  live feed   │
│ sections    │  services / errors / ... │              │
└─────────────┴──────────────────────────┴──────────────┘
```

## Sections

| # | Section | Component | Backend Endpoint(s) | Description |
|---|---------|-----------|---------------------|-------------|
| 1 | Overview | `overview-content.tsx` | `GET /v1/health`, `GET /v1/system/metrics` | Resumen de salud + métricas clave |
| 2 | Incidents | `incidents-content.tsx` | `GET /v1/system/errors` | Incidentes activos y recientes |
| 3 | Deployments | `deployments-content.tsx` | — | Historial de deployments (placeholder) |
| 4 | Performance | `performance-content.tsx` | `GET /v1/system/metrics` | Gráficos de performance y latency |
| 5 | Errors | `errors-content.tsx` | `GET /v1/system/errors` | Lista de errores con severidad |
| 6 | SLA | `sla-content.tsx` | — | Métricas SLA (placeholder) |
| 7 | On-Call | `oncall-content.tsx` | — | Guardias activas (placeholder) |
| 8 | Services | `services-content.tsx` | `GET /v1/system/services` | Estado de cada servicio del sistema |
| 9 | Postmortems | `postmortems-content.tsx` | — | Postmortems (placeholder) |
| 10 | Settings | `settings-content.tsx` | — | Configuración del dashboard |

### Requirement 1: API Client

The system MUST provide a typed API client (`lib/api-client.ts`) that wraps all backend endpoints.

#### Scenario: Fetch health data

- GIVEN the dashboard loads
- WHEN `apiClient.getHealth()` is called
- THEN it MUST return `SystemHealth` with `server_status`, `services[]`, `ta_expiration`
- AND it MUST timeout after 15 seconds

#### Scenario: Fetch system metrics

- GIVEN the user views the overview or performance section
- WHEN `apiClient.getMetrics(period)` is called with period `"24h"`, `"7d"`, or `"30d"`
- THEN it MUST return `SystemMetrics` with pipeline run stats

#### Scenario: API error handling

- GIVEN the backend returns a non-2xx status
- WHEN any API call fails
- THEN `ApiError` MUST be thrown with `status` and `detail`
- AND the hook MUST surface the error in the UI

### Requirement 2: useSystemData Hook

The system MUST provide a `useSystemData` hook that manages loading, error, and data state for all dashboard sections.

#### Scenario: Loading state

- GIVEN the dashboard mounts
- WHEN data is being fetched
- THEN each section MUST show a loading indicator (spinner/skeleton)
- AND no "data not available" flash SHOULD appear

#### Scenario: Error state

- GIVEN the backend is unreachable
- WHEN all API calls fail
- THEN the UI MUST display an error message
- AND offer a retry mechanism

#### Scenario: Empty state

- GIVEN the backend returns empty data (no pipeline runs, no errors)
- WHEN a section renders
- THEN it MUST show an empty state message instead of a broken UI
- AND no mock/fallback data SHALL be displayed

### Requirement 3: Overview Section

The system MUST display a summary of system health and key metrics on the Overview tab.

#### Scenario: All services healthy

- GIVEN all backend services respond
- WHEN the overview section renders
- THEN it MUST show a green health indicator
- AND display pipeline run counts (24h/7d/30d)
- AND show active service count

#### Scenario: Service unhealthy

- GIVEN one or more services are down
- WHEN the overview section renders
- THEN it MUST show a warning/error indicator
- AND list which services are affected

### Requirement 4: Services Section

The system MUST display per-service status with latency and last check time.

#### Scenario: Services list renders

- GIVEN `GET /v1/system/services` returns data
- WHEN the services section renders
- THEN each service MUST show `name`, `status`, `latency_ms`, `last_check`
- AND unhealthy services MUST be visually distinct

### Requirement 5: Errors Section

The system MUST display a list of system errors with severity, timestamp, and affected service.

#### Scenario: Error list renders

- GIVEN `GET /v1/system/errors` returns data
- WHEN the errors section renders
- THEN each error MUST show `type`, `severity`, `timestamp`, `service`, `message`
- AND errors MUST be sortable/filterable by severity

## Architecture Decisions

| AD | Decision |
|----|----------|
| AD 1 | No mock data — dashboard shows empty/loading/error states instead of fallback data. All data comes from real backend endpoints |
| AD 2 | Client-side routing via React state — no Next.js pages for each section, single page with `activeSection` state |
| AD 3 | 15s timeout on all API calls — backend pipeline operations can be slow |
| AD 4 | Next.js rewrites proxy `/api/*` → backend — avoids CORS, hides API key from bundle |

## File Structure

```
frontend/IdeaDashboardControlSistema_v0-joaquindev23-6a0ac6de/
├── app/
│   ├── layout.tsx
│   ├── page.tsx              # Layout 3 paneles + activeSection state
│   └── globals.css
├── components/
│   ├── dashboard/
│   │   ├── app-sidebar.tsx    # Navegación lateral
│   │   ├── main-content.tsx   # Router de secciones
│   │   ├── right-panel.tsx    # Activity feed
│   │   └── content/
│   │       ├── overview-content.tsx
│   │       ├── incidents-content.tsx
│   │       ├── deployments-content.tsx
│   │       ├── performance-content.tsx
│   │       ├── errors-content.tsx
│   │       ├── sla-content.tsx
│   │       ├── oncall-content.tsx
│   │       ├── services-content.tsx
│   │       ├── postmortems-content.tsx
│   │       └── settings-content.tsx
│   ├── ui/                    # shadcn/ui primitives
│   └── theme-provider.tsx
├── hooks/
│   ├── useSystemData.ts       # Estado global de datos del dashboard
│   ├── use-toast.ts
│   └── use-mobile.ts
├── lib/
│   ├── api-client.ts          # API client tipado
│   ├── types.ts               # Tipos de datos del dashboard
│   ├── data.ts                # Helpers de transformación
│   └── utils.ts
├── Dockerfile
├── package.json
├── tsconfig.json
└── next.config.mjs
```

## Backend Dependencies

| Backend Endpoint | Método | Uso en Dashboard |
|-----------------|--------|------------------|
| `GET /v1/health` | Health extendido | Overview — health summary + services status |
| `GET /v1/system/metrics?period=` | System metrics | Overview, Performance — pipeline run stats |
| `GET /v1/system/services` | Service status | Services section |
| `GET /v1/system/activity?limit=&offset=` | Activity feed | Right panel |
| `GET /v1/system/errors?limit=&offset=` | Error list | Errors, Incidents sections |
