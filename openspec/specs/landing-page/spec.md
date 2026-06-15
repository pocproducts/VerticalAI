# Landing Page Specification

## Purpose

Sitio web institucional de **Optimus — The AI Platform** que presenta el producto, sus funcionalidades, casos de uso, planes de pricing, y llamada a la acción. Es la puerta de entrada al ecosistema Fiscal Agent.

No reemplaza ni duplica la funcionalidad del backend. Es un frontend puramente de marketing/presentación.

## Stack

| Capa | Tecnología |
|------|-----------|
| Framework | Next.js 16 (App Router) |
| UI | React 19, TypeScript, Tailwind CSS 4, shadcn/ui (Radix UI primitives) |
| 3D | Three.js / @react-three/fiber |
| Gráficos | Recharts |
| Idioma | Multi-idioma vía `LanguageProvider` + `lib/i18n.tsx` |

## Sections

| # | Section | Component | Description |
|---|---------|-----------|-------------|
| 1 | Navigation | `navigation.tsx` | Header con logo, links de navegación, selector de idioma, CTA buttons |
| 2 | Hero | `hero-section.tsx` | Value proposition principal con Three.js 3D background |
| 3 | Features | `features-section.tsx` | Grid de características del producto |
| 4 | How It Works | `how-it-works-section.tsx` | Flujo paso a paso de cómo funciona la plataforma |
| 5 | Infrastructure | `infrastructure-section.tsx` | Detalles de infraestructura y arquitectura |
| 6 | Metrics | `metrics-section.tsx` | Métricas y estadísticas destacadas (Recharts) |
| 7 | Integrations | `integrations-section.tsx` | Integraciones con servicios externos |
| 8 | Security | `security-section.tsx` | Certificaciones y políticas de seguridad |
| 9 | Developers | `developers-section.tsx` | Documentación para desarrolladores, API, SDK |
| 10 | Testimonials | `testimonials-section.tsx` | Testimonios de clientes |
| 11 | Pricing | `pricing-section.tsx` | Planes y precios por uso/token |
| 12 | CTA | `cta-section.tsx` | Call to action final |
| 13 | Footer | `footer-section.tsx` | Links legales, redes, contacto |

### Requirement 1: Navigation

The system MUST render a fixed header with logo, navigation links, language selector, and CTA buttons.

#### Scenario: Header renders on all pages

- GIVEN the landing page loads
- WHEN the user scrolls
- THEN the navigation MUST remain visible at the top
- AND the language selector MUST be positioned on the left side near the logo

#### Scenario: Language switcher changes UI language

- GIVEN the user clicks the language selector
- WHEN switching to a different language
- THEN all visible text MUST update to the selected language
- AND the selection MUST persist during the session

### Requirement 2: Hero Section

The system MUST display the main value proposition with a 3D animated background (Three.js).

#### Scenario: Hero renders with 3D background

- GIVEN the landing page loads
- WHEN the hero section is visible
- THEN the 3D animated background MUST render (tetrahedron / sphere / wave)
- AND the main headline + subtitle MUST be readable over the animation

### Requirement 3: Pricing Section

The system MUST display pricing plans with token-based tiers.

#### Scenario: Pricing table renders correctly

- GIVEN the user scrolls to the pricing section
- WHEN the section is in viewport
- THEN it MUST show plan tiers (Mini / Pro / Max / Max Fast)
- AND each tier MUST display Input/Cache Write/Cache Read/Output token pricing

### Requirement 4: Multi-language Support

The system MUST support at least two languages via `LanguageProvider` context.

#### Scenario: Switch language updates all sections

- GIVEN the user selects a different language in the navigation
- WHEN the language changes
- THEN ALL sections on the page MUST reflect the selected language
- AND the URL MUST remain unchanged (client-side i18n)

## Architecture Decisions

| AD | Decision |
|----|----------|
| AD 1 | Client-side i18n via React context (no next-intl) — landing page is a single page, no routing needed |
| AD 2 | Three.js for 3D backgrounds — visual impact for marketing, degrades gracefully on low-end devices |
| AD 3 | Static export compatible — no backend dependency, can be deployed to CDN/static hosting |
| AD 4 | No SSR for sections below the fold — sections use client-side intersection observer for lazy rendering |

## File Structure

```
frontend/IdeaLandingPage_optimus-the-ai-platform-to-bu/
├── app/
│   ├── layout.tsx
│   ├── page.tsx          # Composición de secciones
│   └── globals.css
├── components/
│   └── landing/
│       ├── navigation.tsx
│       ├── hero-section.tsx
│       ├── features-section.tsx
│       ├── how-it-works-section.tsx
│       ├── infrastructure-section.tsx
│       ├── metrics-section.tsx
│       ├── integrations-section.tsx
│       ├── security-section.tsx
│       ├── developers-section.tsx
│       ├── testimonials-section.tsx
│       ├── pricing-section.tsx
│       ├── cta-section.tsx
│       ├── footer-section.tsx
│       ├── animated-wave.tsx        (Three.js)
│       ├── animated-tetrahedron.tsx (Three.js)
│       └── animated-sphere.tsx      (Three.js)
├── lib/
│   ├── utils.ts
│   └── i18n.tsx           # LanguageProvider + traducciones
├── public/
├── Dockerfile
├── package.json
├── tsconfig.json
└── next.config.mjs
```
