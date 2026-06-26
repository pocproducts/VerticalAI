# Design: chat-step-persistence

## Architecture

### Before (flujo actual)
```
sendMessage() → assistantMsg.pipelineSteps = steps
                                        ↓
                              Message.jsx: IGNORA pipelineSteps ✗
                                        ↓
                              latestPipelineSteps ← efímero (se pierde)
                                        ↓
                              CompletedPipeline ← solo mientras estado vivo
```

### After (flujo deseado)
```
sendMessage() → assistantMsg.pipelineSteps = steps
                                        ↓
                              Message.jsx: RENDERIZA pipelineSteps ✓
                                        ↓
                              useChat.js rehidrata latestPipelineSteps
                              desde mensajes al cargar conversación
                                        ↓
                              CompletedPipeline eliminado (ya no necesario)
```

## Component changes

### 1. Message.jsx
**Current** (line 60):
```js
const hasWizardData = message?.wizardData
```

**New**:
```js
const pipelineSteps = message?.pipelineSteps || []
const wizardData = message?.wizardData || null
const hasSteps = pipelineSteps.length > 0 || wizardData?.steps?.length > 0
```

**WizardResultMessage** se renombra a `StepRenderer` y acepta:
```js
function StepRenderer({ steps }) {
  // steps puede venir de pipelineSteps (sin ts) o wizardData.steps (con ts)
  // El ts es opcional para render — ignorar si no existe
  // Mismo formato visual: icono + mensaje por step
}
```

### 2. useChat.js
**Add effect** para rehidratar `latestPipelineSteps`:

```js
useEffect(() => {
  if (!selectedConversation) return
  const msgs = selectedConversation.messages || []
  const lastAssistant = [...msgs].reverse().find(m => m.role === 'assistant')
  if (lastAssistant?.pipelineSteps?.length > 0) {
    setLatestPipelineSteps(lastAssistant.pipelineSteps)
  } else if (lastAssistant?.wizardData?.steps?.length > 0) {
    setLatestPipelineSteps(lastAssistant.wizardData.steps)
  }
}, [selectedConversation?.id])
```

### 3. ChatPane.jsx
- Eliminar componente `CompletedPipeline`
- Eliminar `latestPipelineSteps` del render directo
- Los steps ahora viven en los mensajes → Message.jsx los renderiza
- `ProgressMessage` se mantiene para el stream en vivo
- Panel derecho: mantener `panelSteps` pero simplificar lógica

## Data flow

```
SSE stream ──► onProgress ──► progressSteps (React state) ──► ProgressMessage (en vivo)
                                                    │
                                                    ▼
                                        assistantMsg.pipelineSteps = steps
                                                    │
                                                    ├──► LocalStorage (persiste)
                                                    │
                                                    ▼
                                        Message.jsx renderiza steps ←── desde mensaje almacenado
```
