# Change 003: PDF Header Marker + Deuda Fix

## Intent
Estabilizar el pipeline completo del PDF: corregir deuda vacía, reestructurar páginas, agregar headers de sección con soporte multi-página, y unificar estilos de tablas.

## Spec

### Fix deuda vacía en PDF
- **Problema**: `_consolidate()` en `composio.py` solo tomaba `last_ok.parsed_data` (última task exitosa). Con `--with-deuda --with-facilidades --with-registro`, la última es RegistroTask, que no tiene `vencimientos`/`deudas`.
- **Solución**: Buscar `vencimientos` y `deudas` en TODAS las tasks exitosas (primera que contenga esos datos), igual que ya se hacía con `facilidades` y `registro`.

### Reestructuración de páginas del PDF
- P1: Portada (título + descripción + contribuyente)
- P2: WebService — Obligaciones Registrales (detalle con importes matched)
- P3: Calendario de Vencimientos
- P4: Detalle de Deuda — ARCA (ctacte.cloud)
- P5: Planes de Pago — Mis Facilidades ARCA
- P6: Registro Tributario — IIBB e Impuestos (con Domicilios, Actividades, Impuestos, Puntos de venta)
- P7: Rentas Córdoba (placeholder, opcional)

### Headers por sección
- Mecanismo: flowable `_HeaderMarker` (hereda de `Flowable`) que se coloca ANTES de cada `PageBreak`
- `_HeaderMarker.draw()` actualiza `self._current_header` en el PdfGenerator
- El callback `onPage` lee `self._current_header` y lo dibuja en el canvas
- Soporta secciones multi-página (Planes de Pago): el header no cambia hasta el próximo marker
- Footer: "VERTICAL AI | Agente Fiscal" en todas las páginas
- Títulos removidos del contenido (ahora van solo en el header)

### Estilos de tablas
- `_draw_table`: header centrado, datos LEFT alignment, padding 4/5
- `_build_table` (calendario): font 9, padding 5/6 (coherente con detalle)

## Design

### _HeaderMarker flowable
```python
class _HeaderMarker(Flowable):
    def __init__(self, generator, title):
        Flowable.__init__(self)
        self._gen = generator
        self._title = title
        self.width = 0
        self.height = 0
    def wrap(self, availWidth, availHeight):
        return (0, 0)
    def draw(self):
        self._gen._current_header = self._title
```

### Archivos modificados
- `fiscal_agent/browser/composio.py` — _consolidate(): vencimientos/deudas search all tasks
- `fiscal_agent/pdf_generator.py` — _HeaderMarker, page reorder, onPage callback, _draw_table alignment, content titles removed

## Tasks
- [x] Fix _consolidate() multi-task search
- [x] Reorder PDF pages (P1-P7)
- [x] Create _HeaderMarker flowable class
- [x] Wire onPage callback with _current_header + footer
- [x] Remove section titles from page content
- [x] Fix _draw_table alignment (LEFT data, CENTER header)
- [x] Restore Actividades + Puntos de venta in Registro
- [x] Unify calendar table style with detalle table
- [x] Clean Python cache

## Verify

Probado con pipeline completo (`--with-deuda --with-facilidades --with-registro`) el 2026-06-11:

- ✅ Headers de sección correctos en cada página
- ✅ Footer "VERTICAL AI | Agente Fiscal" en todas las páginas
- ✅ Deuda visible (no más vacía tras fix de _consolidate)
- ✅ Planes de Pago multi-página con header persistente
- ✅ Tablas con estilo unificado (header centrado, datos LEFT)
- ✅ Cache de Python limpiado

**Estado: COMPLETADO Y VERIFICADO ✅**
