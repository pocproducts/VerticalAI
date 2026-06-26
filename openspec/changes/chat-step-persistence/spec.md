# Spec: chat-step-persistence

## Requirements

### R1: Render pipelineSteps en Message.jsx
- `Message.jsx` debe detectar `message.pipelineSteps` además de `message.wizardData`
- El componente `WizardResultMessage` debe extenderse para renderizar steps desde ambos formatos: `pipelineSteps: [{message, status}]` y `wizardData.steps: [{message, status, ts}]`
- Si un mensaje tiene `pipelineSteps`, se renderizan antes del contenido markdown
- Si no tiene metadata, solo renderiza content como hoy

### R2: Rehidratar latestPipelineSteps en useChat.js
- Al cargar una conversación, derivar `latestPipelineSteps` del último mensaje assistant que tenga `pipelineSteps` o `wizardData.steps`
- Esto aplica tanto para carga desde API como desde LocalStorage
- No sobrescribir metadata durante el merge

### R3: Simplificar ChatPane.jsx
- Eliminar el componente `CompletedPipeline` (ya no es necesario — los steps los renderiza Message.jsx)
- Simplificar `panelSteps` para que use solo `progressSteps` durante el stream en vivo
- Panel derecho (ResultPanel) debe seguir funcionando con los steps que recibe

## Scenarios

### S1: Usuario envía "reporte CUIT 20324837796"
1. Se crea mensaje user con el texto
2. SSE stream comienza → `progressSteps` se actualiza en vivo
3. SSE complete → `assistantMsg` se crea con `pipelineSteps` adjuntos
4. Message.jsx renderiza los steps del mensaje assistant
5. Usuario recarga la página
6. Conversación se carga → mensajes tienen `pipelineSteps`
7. Message.jsx renderiza los steps nuevamente
8. ✅ Steps visibles antes y después del refresh

### S2: Usuario usa wizard (CUIT → tasks → generación)
1. Wizard fluye normalmente
2. `onWizardComplete` guarda `wizardData.steps`
3. Message.jsx renderiza steps via `WizardResultMessage` (ya funciona)
4. ✅ Sin regresión

### S3: Usuario cambia de conversación
1. Usuario está viendo conversación A con steps
2. Selecciona conversación B
3. Vuelve a conversación A
4. Los steps de A se renderizan desde los mensajes almacenados
5. ✅ Steps persistentes entre cambios de conversación

## Data contracts

```typescript
// Formato pipelineSteps (sendMessage path)
interface PipelineStep {
  message: string
  status: "in_progress" | "done" | "error" | "warning" | "info"
}

// Formato wizardData.steps (onWizardComplete path)
interface WizardStep {
  message: string
  status: "in_progress" | "done" | "error" | "warning" | "info"
  ts: number
}

// Unificado para render (Message acepta ambos)
type Step = PipelineStep | WizardStep
```
