# Proposal: chat-step-persistence

## Intent
Resolver que los pasos del pipeline (pipelineSteps) se pierdan al recargar la página o cambiar de conversación en la columna del medio (Chat).

## Scope
**Phase 1 (ahora)** — Solo frontend, 3 archivos:
1. `Message.jsx` — renderizar `pipelineSteps` además de `wizardData`
2. `useChat.js` — rehidratar `latestPipelineSteps` desde mensajes almacenados
3. `ChatPane.jsx` — eliminar `CompletedPipeline` efímero, dejar que Message.jsx maneje steps históricos

**Phase 2 (futuro)** — Backend persiste metadata, contrato SSE formal.

## Non-goals
- No tocar backend (Redis, store, API)
- No cambiar contrato SSE
- No migrar datos existentes

## Current behavior
- `sendMessage()` guarda `pipelineSteps` en el mensaje assistant (`useChat.js:335`)
- `Message.jsx` solo revisa `message.wizardData` — ignora `pipelineSteps`
- `latestPipelineSteps` es estado efímero que se pierde al cambiar de conversación
- `CompletedPipeline` en ChatPane solo vive mientras el estado no se resetea

## Desired behavior
- Un mensaje assistant con `pipelineSteps` los muestra siempre en el historial
- Al cambiar de conversación o recargar, los steps persisten
- No hay dos fuentes de verdad compitiendo (wizard y pipeline usan el mismo render)

## Approach
1. **Message.jsx**: Agregar `message?.pipelineSteps` al condicional de render. Extender `WizardResultMessage` para aceptar ambos formatos.
2. **useChat.js**: En `loadHistory` o con un `useEffect` sobre `selectedConversation`, derivar `latestPipelineSteps` del último mensaje assistant.
3. **ChatPane.jsx**: Eliminar `CompletedPipeline` — los steps los renderiza Message.jsx directamente. Simplificar lógica de `panelSteps`.

## Risk
- Bajo. No se toca backend. Solo se agregan paths de render que antes no existían.
- Riesgo de duplicación visual si `CompletedPipeline` y `Message.jsx` muestran steps simultáneamente → mitigado eliminando `CompletedPipeline`.
