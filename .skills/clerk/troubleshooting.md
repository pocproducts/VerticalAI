---
title: Clerk FAQ y Troubleshooting
agent: gentle-orchestrator, sdd-apply
description: Problemas comunes y soluciones al trabajar con Clerk en este proyecto
trigger: Clerk error, 500, missing key, JWT no valido, tenant no encontrado
---

# Clerk — FAQ y Troubleshooting

## 1. Frontend: 500 Internal Server Error

**Síntoma**: `Error: @clerk/nextjs: Missing secretKey`

**Causa**: `CLERK_SECRET_KEY` no está en el environment del contenedor en runtime.

**Solución**: Agregar al `docker-compose.yml` del servicio frontend:
```yaml
environment:
  - CLERK_SECRET_KEY=${CLERK_SECRET_KEY-}
```
Y reiniciar: `docker compose up -d` (sin rebuild).

> Clerk v6 middleware necesita la secret key en runtime, no solo en build-time.

## 2. Backend: 401 TENANT_NOT_FOUND

**Síntoma**: El JWT de Clerk tiene `org_id` pero el tenant no existe en Redis.

**Causa**: El usuario pertenece a una org de Clerk que nunca se sincronizó al backend.

**Solución**: 
- Crear tenant manualmente en Redis, o
- Implementar webhook `organization.created` de Clerk que cree el tenant automáticamente

Si no hay `org_id` en el JWT, el backend crea un tenant personal automático (`user_{sub[:12]}`).

## 3. Frontend: Redirect a `/chat` da 404

**Síntoma**: Después de login, redirige a `/chat` y da 404.

**Causa**: El chat vive en `/` (raíz), no en `/chat`. No existe ruta `/chat`.

**Solución**: Usar `forceRedirectUrl="/"` en los componentes `<SignIn>` y `<SignUp>`.

## 4. Backend: Rate limits con valores incorrectos

**Síntoma**: Los rate limits no coinciden con el plan del tenant.

**Causa**: `ClerkJWTExtractor` hardcodea `{'rpm': 10, 'rpd': 100}` en vez de leer de `plan.rate_limit_*`.

**Solución**: Usar los valores del plan:
```python
request.state.rate_limit_config = {
    'rpm': plan.rate_limit_rpm if plan else 10,
    'rpd': plan.rate_limit_rpd if plan else 100,
}
```

## 5. Frontend: Botón Eliminar conversación no funciona

**Síntoma**: Click en "Eliminar" en el menú contextual del chat no hace nada.

**Causa**: `Sidebar.jsx` no pasa `onDelete`/`onRename` a `ConversationRow`.

**Cadena completa**:
```
useChat() → deleteConversation → AIAssistantUI → Sidebar → ConversationRow
```
Asegurarse de que:
1. `useChat()` exporta `deleteConversation`
2. `AIAssistantUI` lo destructura y lo pasa como `onDelete={deleteConversation}` a `<Sidebar>`
3. `Sidebar` lo acepta como prop y lo pasa a `<ConversationRow onDelete={onDelete}>`

## 6. Env vars para desarrollo local

Para desarrollo fuera de Docker, el frontend necesita un `.env.local`:
```
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
NEXT_PUBLIC_API_URL=http://localhost:8000
```

El backend necesita las vars en el entorno o en `.env`:
```
CLERK_SECRET_KEY=sk_test_...
CLERK_DOMAIN=tu-clerk-domain
```
