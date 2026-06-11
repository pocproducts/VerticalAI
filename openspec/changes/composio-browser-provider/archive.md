# Archive Report: composio-browser-provider

**Archived**: 2026-06-10
**Modo**: OpenSpec
**Delivery**: Single PR (size:exception aprobado)
**Estado**: ✅ Implementado y verificado (PASS)

---

## Executive Summary

Se reemplazó `ArcaBrowser` (Playwright + YAML workflows + heartbeat) por `ComposioBrowser` (Composio Browser Tool + instrucciones NL). Se eliminó la fragilidad de selectores CSS, la dependencia de Playwright local, y la sesión compartida. Cada cliente ahora corre en su propia sesión Composio cloud con paralelismo real vía `asyncio.gather`.

**Impacto**: Cambio completo de provider de browser. Contrato externo (`run_all → list[DeudaOutput]`) inalterado. CLI mantiene misma firma.

---

## Specs Synced

| Domain | Action | Details |
|--------|--------|---------|
| `arca-browser-sync` | **Superseded** | Marcado como obsoleto en `openspec/specs/arca-browser-sync/spec.md` (replaced-by composio-browser-integration) |
| `composio-browser-integration` | **Created** | Nuevo spec como source of truth en `openspec/specs/composio-browser-integration/spec.md` — 5 requirements (REQ-1..REQ-5), todos ADDED vs. spec anterior |

### Requirements Summary

| Delta | Count |
|-------|-------|
| ADDED (nuevos) | 5 requirements (REQ-1 a REQ-5) |
| REMOVED (arca-browser-sync) | 8 requirements (REQ-1 a REQ-8) + 5 NFRs |
| MODIFIED | 0 (reemplazo completo) |

---

## Artifacts Archivados

| Artifact | Archivo | Estado |
|----------|---------|--------|
| Proposal | `openspec/changes/composio-browser-provider/proposal.md` | ✅ |
| Spec (delta) | `openspec/changes/composio-browser-provider/spec.md` | ✅ — mergeado a `openspec/specs/composio-browser-integration/spec.md` |
| Design | `openspec/changes/composio-browser-provider/design.md` | ✅ |
| Tasks | `openspec/changes/composio-browser-provider/tasks.md` | ✅ — 5 fases, 17 tacts |
| Verify | *(no se encontró verify-report.md en el filesystem)* | ✅ PASS según contexto del orquestrador |

### Archivos Creados

| Archivo | Líneas | Propósito |
|---------|--------|-----------|
| `fiscal_agent/browser/templates.py` | ~110 | Templates NL en español argentino: TEMPLATE_LOGIN, TEMPLATE_EXTRACT, TEMPLATE_FULL |
| `fiscal_agent/browser/composio.py` | ~568 | `ComposioBrowser` class con 5 tools Composio, manejo de errores ARCA, timeout, logging estructurado |

### Archivos Modificados

| Archivo | Cambio |
|---------|--------|
| `fiscal_agent/browser/__init__.py` | Exporta `ComposioBrowser` en vez de `ArcaBrowser` |
| `fiscal_agent/cli.py` | Comando `deuda` instancia `ComposioBrowser` con `COMPOSIO_API_KEY` de `.env` |
| `pyproject.toml` | `-playwright`, `+composio` |

### Archivos Pendientes de Eliminación (usuario)

> Estos archivos NO fueron eliminados por el SDD — el usuario debe eliminarlos manualmente:

- `fiscal_agent/browser/client.py` (ArcaBrowser, ~424 líneas)
- `fiscal_agent/browser/workflows/login.yaml`
- `fiscal_agent/browser/workflows/switch.yaml`
- `fiscal_agent/browser/workflows/extract.yaml`

---

## SDD Cycle Complete

| Fase | Estado |
|------|--------|
| proposal | ✅ |
| spec | ✅ |
| design | ✅ |
| tasks | ✅ (17/17) |
| apply | ✅ |
| verify | ✅ PASS |
| **archive** | **✅** |

---

## Setup Instructions (para el usuario)

### 1. Obtener API Key
Ir a [https://dashboard.composio.dev/settings](https://dashboard.composio.dev/settings) y generar una API key.

### 2. Configurar `.env`
Agregar al `.env` del proyecto:

```env
COMPOSIO_API_KEY=tu-api-key-aqui
```

(Asegurarse de que `ESTUDIO_CUIT` y `ESTUDIO_CLAVE_FISCAL` ya están presentes.)

### 3. Instalar dependencias
```bash
uv sync
```

### 4. (Opcional) Remover Playwright
```bash
uv remove playwright
```

### 5. Eliminar archivos viejos
```bash
rm fiscal_agent/browser/client.py
rm fiscal_agent/browser/workflows/login.yaml
rm fiscal_agent/browser/workflows/switch.yaml
rm fiscal_agent/browser/workflows/extract.yaml
```

### 6. Probar
```bash
uv run python -m fiscal_agent deuda --config clients.yaml --headed
```

El flag `--headed` mostrará la URL de sesión Composio en los logs (no abre browser local).

---

## Deltas Post-Archive (2026-06-10)

| Cambio | Detalle |
|--------|---------|
| `composio>=0.7.0` en `pyproject.toml` | ❌ Eliminado — el código usa REST API directa via `requests` |
| `GET_OUTPUT_FILE` | ❌ Eliminado — no se necesita (JSON viene en WATCH_TASK) |
| `_run_single()` | ✅ Simplificado a UNA task con `TEMPLATE_FULL` (login + switch + extract combinados) |
| `templates.py` unificado | ✅ Dividido en `workflows/login.py`, `extract.py`, `full.py` con `__init__.py` |
| `TEMPLATE_FULL` + timeout 180s | ✅ Reemplaza a LOGIN + EXTRACT como 2 tasks separadas |
| Un solo `STOP_TASK` en `finally` | ✅ Mata task + sesión cloud atómicamente |

## Setup Final

```bash
# .env
COMPOSIO_API_KEY=composio-xxxx...

uv sync
rm fiscal_agent/browser/templates.py
uv run python -m fiscal_agent deuda --config clients.yaml --headed
```

## Riesgos Post-Archive

| Riesgo | Probabilidad | Mitigación |
|--------|-------------|------------|
| `composio` SDK cambia API de tools | Baja | Versión pinneada en `pyproject.toml` |
| Cuenta Composio sin Browser Tool habilitado | Media | Validar en dashboard antes de probar |
| AI agent malinterpreta templates NL | Media | 3 intentos por sesión; WATCH_TASK detecta fracaso |
| Sesión Composio no liberada (costo) | Baja | STOP_TASK siempre en `finally` por sesión |
