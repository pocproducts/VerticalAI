# Proposal: Chat UI Wizard

## Context

El chat actual (`POST /v1/chat/message`) solo acepta texto libre. Cuando detecta `REPORTE_COMPLETO`, ejecuta el pipeline completo con **todas** las tareas activadas sin posibilidad de selección individual. No hay estado multi-turno, ni descubrimiento de cliente, ni onboarding visual.

El CLI en cambio tiene un wizard interactivo: pide CUIT → descubre cliente → pregunta qué tareas ejecutar → corre pipeline → ofrece enviar email.

Este cambio replica ese wizard en la UI del chat, reemplazando el empty state textual por un onboarding visual con steps guiados.

## Intent

Que el usuario pueda generar un reporte fiscal desde la UI sin conocer comandos de lenguaje natural: ingresa CUIT, selecciona las tareas que necesita (deuda, facilidades, registro, IIBB), y ve el progreso en tiempo real.

## Scope

### In Scope
- **Frontend**: Reemplazar el empty state por onboarding visual con input de CUIT, checkboxes de tareas, botón "Generar reporte", indicador de progreso y resultado
- **Backend**: Nuevo endpoint `POST /v1/chat/wizard` con estado multi-turno (`awaiting_cuit` → `awaiting_tasks` → `processing` → `complete`) que acepte `{ cuit, tasks, conversation_id }`
- **Backend**: Reutilizar `PipelineService.run_pipeline()` con los flags seleccionados por el usuario
- **UX**: El wizard es opt-in — el Composer de texto libre sigue funcionando para queries rápidas (consulta CUIT, calendario, etc.)

### Out of Scope
- Modificar endpoints existentes `POST /v1/chat/message` y `/stream` (siguen igual)
- Modificar `PipelineService.run_pipeline()` (se reutiliza tal cual)
- Modificar Clerk auth, Sidebar, Header, SettingsPopover
- Envío de email post-PDF (se mantiene `send_email=False` como hoy)

## Capabilities

### New
- None

### Modified
- `chat-backend`: Nuevo endpoint `POST /v1/chat/wizard` con estado multi-turno + selección de tareas
- `chat-frontend`: Nuevo componente `WizardOnboarding` que reemplaza empty state; integración con `useChat` para wizard flow

## Approach

### Backend

1. Nuevo `POST /v1/chat/wizard` en `chat.py`:
   - Request: `{ cuit: str | null, tasks: { deuda, facilidades, registro, iibb } | null, conversation_id: str | null }`
   - Response: `{ conversation_id, state: "awaiting_cuit" | "awaiting_tasks" | "processing" | "complete", reply, data }`
   - Lógica de estado vía conversación en Redis (reusar `conversation-storage`) o session en memoria:
     - `awaiting_cuit`: si `cuit` es null → reply pide CUIT
     - `awaiting_tasks`: si `cuit` presente pero `tasks` null → reply con opciones + auto-descubrimiento de cliente vía `_completar_cliente_desde_padron`
     - `processing`: si `cuit` + `tasks` presentes → delega a `PipelineService.run_pipeline()` con flags correspondientes
     - `complete`: devuelve resultado + PDF link

2. Reusar `_handle_reporte_with_echo()` internamente para el paso `processing`, con SSE para progreso.

3. Almacenar estado en Redis bajo `tenant:{tenant_id}:wizard:{conversation_id}` con TTL 1 hora.

### Frontend

1. Nuevo componente `WizardOnboarding.jsx`:
   - Step 1: Input de CUIT (con validación de 11 dígitos) + botón "Continuar"
   - Step 2: Checkboxes/toggle buttons para cada extracción (deuda, facilidades, registro, IIBB), todas seleccionadas por defecto + botón "Generar reporte"
   - Step 3: Indicador de progreso (reusa `ProgressMessage` existente) + resultado con link a PDF

2. Modificar `ChatPane.jsx`:
   - Si `messages.length === 0` y no hay conversación wizard activa → mostrar `WizardOnboarding` en lugar del empty state actual
   - Si el usuario envía texto en el Composer → flujo normal (texto → `sendMessage`)
   - Si el usuario usa el wizard → flujo wizard (`POST /v1/chat/wizard`)

3. El hook `useChat` no se modifica — el wizard maneja su propio estado o se integra como un modo adicional.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `fiscal_agent/api/routes/chat.py` | Modified | Nuevo endpoint `POST /v1/chat/wizard` + lógica de estado |
| `fiscal_agent/api/routes/chat.py` | Modified | `_handle_reporte()` acepta flags dinámicos (no hardcodeados) |
| `frontend/.../components/WizardOnboarding.jsx` | New | Componente wizard con steps CUIT → tareas → progreso |
| `frontend/.../components/ChatPane.jsx` | Modified | Mostrar WizardOnboarding en empty state |
| `frontend/.../hooks/useChat.js` | Modified | Soporte opcional para wizard flow |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Romper endpoints existentes | Low | No se modifican — solo se agrega ruta nueva |
| Estado wizard perdido por crash | Low | Redis con TTL 1h; si expira, el usuario ve el estado inicial |
| Usuario confundido entre wizard y chat libre | Low | Wizard solo aparece en empty state; una vez que hay mensajes, el Composer de texto es el default |
| Cliente no descubierto desde el padrón | Low | Se muestra error en el step 1 y se permite reintentar |

## Rollback Plan

1. Eliminar endpoint `POST /v1/chat/wizard` de `chat.py`
2. Revertir `_handle_reporte()` a flags hardcodeados (actual)
3. Eliminar `WizardOnboarding.jsx`
4. Revertir `ChatPane.jsx` al empty state anterior
5. Revertir `useChat.js` a versión anterior

## Dependencies

- `PipelineService.run_pipeline()` — no se modifica
- Redis conversation storage (ya implementado en `conversation-storage` spec)
- `_completar_cliente_desde_padron()` — para auto-descubrimiento en step 1

## Success Criteria

- [ ] `POST /v1/chat/wizard` retorna estados correctos para cada turno del wizard
- [ ] Pipeline ejecuta SOLO las tareas seleccionadas por el usuario
- [ ] Empty state del chat muestra WizardOnboarding en lugar del texto actual
- [ ] `POST /v1/chat/message` y `/stream` siguen funcionando idéntico sin cambios
- [ ] Usuario completa wizard: CUIT → selecciona tareas → ve progreso → recibe resultado con PDF
