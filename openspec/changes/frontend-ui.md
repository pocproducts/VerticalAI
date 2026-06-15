# Change: Frontend UI — Landing Page + System Dashboard

## Intent

Agregar los 3 frontends Next.js al proyecto Fiscal Agent: Landing Page institucional,
Dashboard de Control del Sistema, e interfaz de Chat Fiscal. Los frontends son
complementarios al pipeline de consola — la base del testing sigue siendo CLI.

## Frontends

### 1. Landing Page (`IdeaLandingPage_optimus-the-ai-platform-to-bu`)

Sitio web institucional de **Optimus — The AI Platform** con:

- Hero section con animaciones 3D (Three.js)
- Features, How It Works, Infrastructure, Metrics, Integrations
- Security, Developers, Testimonials, Pricing (token-based tiers)
- CTA, Footer, Navigation con selector multi-idioma
- Multi-idioma cliente-side via `LanguageProvider` + `lib/i18n.tsx`
- Static export compatible, sin dependencia de backend

**Spec**: `openspec/specs/landing-page/spec.md`

### 2. System Dashboard (`IdeaDashboardControlSistema_v0`)

Dashboard de monitoreo de infraestructura con 3 paneles:

- **AppSidebar**: Navegación entre 10 secciones (overview, incidents, services, errors, etc.)
- **MainContent**: Switch de contenido según sección activa
- **RightPanel**: Activity feed en vivo
- Datos reales desde backend (`/v1/system/*`, `/v1/health`)
- Sin mock data — loading/error/empty states
- Typed API client (`lib/api-client.ts`) + `useSystemData` hook

**Spec**: `openspec/specs/system-dashboard/spec.md`

### 3. Chat UI (`IdeaDashboardai-chatbot-interface-template`)

Interfaz de chat para consultas fiscales en lenguaje natural.

- Conectada al backend via `POST /v1/chat/message`
- `useChat` hook con LocalStorage persistence
- Next.js rewrites proxy `/api/*` → backend
- Docker Compose service (puerto 3000)

**Spec**: `openspec/specs/chat-frontend/spec.md` (archivado en `frontend-chat-ai`)

## Testing Base

Siempre se prueba primero desde la consola/CLI:

```bash
python -m pytest fiscal_agent/tests/
python -m fiscal_agent report 20-XXXXXXXXX
```

Los frontends consumen los mismos endpoints del backend. No hay tests de UI.
El pipeline fiscal completo se valida desde la terminal como antes de tener UI.

## File Structure

```
frontend/
├── IdeaLandingPage_optimus-the-ai-platform-to-bu/   # Landing Page (Next.js 16)
├── IdeaDashboardControlSistema_v0-.../               # System Dashboard (Next.js 16)
└── IdeaDashboardai-chatbot-interface-template/        # Chat UI (Next.js 16)
```

## Backend Dependencies

| Backend Spec | Consumido por |
|-------------|---------------|
| `rest-api` (`/v1/health`, `/v1/chat/message`) | Chat UI, Dashboard |
| `system-health`, `system-metrics`, `system-services` | Dashboard |
| `system-activity`, `system-errors` | Dashboard |
| `chat-backend` | Chat UI |
