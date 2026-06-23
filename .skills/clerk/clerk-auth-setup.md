---
title: Clerk Auth Setup (Frontend)
agent: sdd-apply, gentle-orchestrator
description: Configurar Clerk en Next.js — provider, middleware, sign-in/up, env vars
trigger: agregar Clerk, configurar auth, login con Google, middleware Clerk
---

# Clerk Auth Setup — Frontend Next.js

## Env Variables

```bash
# .env o docker-compose environment
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...   # Build-time + runtime
CLERK_SECRET_KEY=sk_test_...                      # Runtime (needed by middleware v6)
CLERK_DOMAIN=tu-clerk-domain                      # Backend: para JWKS endpoint
```

> `CLERK_SECRET_KEY` es necesaria en RUNTIME para el frontend (Clerk v6 middleware `clerkMiddleware()`). No alcanza con ponerla solo en build-time.

## Root Layout — ClerkProvider

```tsx
// app/layout.tsx
import { ClerkProvider } from '@clerk/nextjs'

export default function RootLayout({ children }) {
  return (
    <ClerkProvider publishableKey={process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY}>
      <html>
        <body>{children}</body>
      </html>
    </ClerkProvider>
  )
}
```

## Middleware — Route Protection

```typescript
// middleware.ts
import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'

// El chat vive en `/` (raíz), NO en /chat
const isProtectedRoute = createRouteMatcher(['/', '/profile(.*)'])

export default clerkMiddleware(async (auth, req) => {
  if (isProtectedRoute(req)) {
    await auth.protect()
  }
})

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
}
```

> **Importante**: El chat (AIAssistantUI) vive en `/`, no en `/chat`. No existe ruta `/chat`.

## Sign-In / Sign-Up Pages

```tsx
// app/(auth)/sign-in/page.tsx
import { SignIn } from '@clerk/nextjs'
export default function SignInPage() {
  return <SignIn forceRedirectUrl="/" />
}

// app/(auth)/sign-up/page.tsx
import { SignUp } from '@clerk/nextjs'
export default function SignUpPage() {
  return <SignUp forceRedirectUrl="/" />
}
```

> `forceRedirectUrl="/"` porque el chat está en la raíz.

## Obtener Token en Componentes

```tsx
import { useAuth } from '@clerk/nextjs'

function MiComponente() {
  const { getToken, isLoaded, isSignedIn } = useAuth()

  const handleRequest = async () => {
    const token = isSignedIn ? await getToken() : null
    const res = await fetch('/api/data', {
      headers: { Authorization: `Bearer ${token}` }
    })
  }
}
```

## Docker — Env Vars Necesarias

```yaml
services:
  frontend:
    environment:
      - NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=${NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY-}
      - CLERK_SECRET_KEY=${CLERK_SECRET_KEY-}   # ← Obligatorio en runtime
      - NEXT_PUBLIC_API_URL=http://fiscal-agent:8000
```

## Datos de Usuario en UI

```tsx
import { useUser, useClerk } from '@clerk/nextjs'

function Header() {
  const { user, isLoaded } = useUser()
  const { signOut } = useClerk()

  if (!isLoaded) return <Skeleton />
  return (
    <div>
      <Avatar src={user.imageUrl} />
      <span>{user.fullName}</span>
      <button onClick={() => signOut({ redirectUrl: '/sign-in' })}>
        Sign out
      </button>
    </div>
  )
}
```

## Multi-tenant con Clerk Organizations

- `org_id` del JWT → `tenant_id` interno
- Sin org → tenant personal derivado de `user_{sub[:12]}`
- Backend: ClerkJWTExtractor crea tenant on-the-fly si no existe
