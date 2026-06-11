# Proposal: rentas-cordoba-matching

## Intent

Contribuyentes inscriptos en Convenio Multilateral IIBB que además tienen "REG. GENERAL IIBB CORDOBA" en su registro tributario necesitan eventualmente integrarse con Rentas Córdoba para consultar deuda y vencimientos provinciales. Este cambio construye el **matching lógico** que detecta cuándo esa integración es necesaria y agrega un **placeholder informativo** en el PDF mientras la integración real no existe. Sin este matching, el pipeline no distingue si un contribuyente con IIBB necesita Córdoba, Buenos Aires, Santa Fe, o todas — y el PDF no refleja que hay una integración pendiente.

## Scope

### In Scope

- **Matching rule**: lógica condicional que determina si un contribuyente requiere integración con Rentas Córdoba
- **Nuevo modelo**: `RentasCordobaMatching` (o flag en el pipeline) con campos `requiere_integracion: bool`, `tiene_convenio_multilateral: bool`, `tiene_iibb_cordoba: bool`
- **Función de matching**: recibe provincias configuradas + impuestos de WS API (Padrón A5) + impuestos de RegistroOutput (RUT) y evalúa la regla
- **PDF placeholder**: nueva página/sección en el PDF que se muestra solo cuando `requiere_integracion=True`, con texto "Rentas Córdoba — en desarrollo" y link https://www.rentascordoba.gob.ar/
- **Pipeline integration**: el matching se ejecuta después de los browser tasks y antes de la generación del PDF, inyectando el resultado al PDF generator

### Out of Scope

- **Integración real con Rentas Córdoba**: no hay API ni browser task que consulte deuda/vencimientos provinciales
- **PDF recategorization**: la reorganización del PDF a formato vertical A4 (calendario→pág1, WS→pág2, browser tasks→pág3+) se implementa en un cambio futuro
- **Matching para otras provincias**: solo Córdoba. Buenos Aires (5905), Santa Fe (5906), CABA (5902) quedan para futuros cambios
- **Tests automatizados** (el proyecto no tiene infraestructura de tests — `strict_tdd: false`)

## Approach

### Regla de matching

Se activa `requiere_integracion=True` cuando **ambas** condiciones se cumplen simultáneamente:

1. **Convenio Multilateral detectado**: el Rules Engine detectó IIBB en el padrón (`idImpuesto` 5904/5902/5905/5906/215 en `regimenGeneral.impuestos`) Y el cliente tiene 2+ provincias configuradas en `ClientConfig.provincias`. Esto ya está implementado en `_obligaciones_para_contribuyente` → agrega `convenio_multilateral` a las obligaciones.
2. **Córdoba en registro tributario**: el `RegistroOutput.impuestos[]` (proveniente de `RegistroTask` vía RUT) contiene un item cuyo campo `impuesto` matchea `"REG. GENERAL IIBB CORDOBA"`.

### Pipeline steps

```
WS API (Padrón A5)
  │
  ▼
RulesEngine.calcular(padron, provincias)   ← ya produce convenio_multilateral si aplica
  │
  ▼
Composio Browser (FullTask, FacilidadesTask, RegistroTask)
  │  RegistroTask → RegistroOutput.impuestos[]
  ▼
MatchingEngine.evaluar(
    provincias=cliente.provincias,
    impuestos_ws=padron.regimenGeneral.impuestos,   # idImpuesto 5904 etc.
    registro_impuestos=deuda_output.registro.impuestos,  # "REG. GENERAL IIBB CORDOBA"
)
  │
  ▼ produzco RentasCordobaMatching { requiere_integracion, ... }
  │
  ▼
PDFGenerator.generar(..., rentas_matching=RentasCordobaMatching)
  │  Si requiere_integracion → agrega página/placeholder
  ▼
Email
```

### Implementación concreta

1. **`fiscal_agent/matching.py`** (nuevo): contiene `RentasCordobaMatching` model + `evaluar_rentas_cordoba()` — función pura que recibe los inputs estructurales y retorna el matching. Sin IO, sin side effects.

2. **`fiscal_agent/models.py`**: agregar `RentasCordobaMatching(BaseModel)`.

3. **`fiscal_agent/cli.py`**: entre los browser tasks y la generación del PDF, llamar al matching y pasar el resultado a `pdf_gen.generar()`.

4. **`fiscal_agent/pdf_generator.py`**:
   - `generar()` acepta nuevo parámetro `rentas_matching: Optional[RentasCordobaMatching] = None`.
   - Nuevo método `_build_rentas_cordoba_placeholder(story, styles)` que agrega texto + link.
   - Se llama como página extra (PageBreak + contenido) si `rentas_matching.requiere_integracion`.

### Detección de IIBB en WS API

La función de matching necesita saber si el contribuyente tiene IIBB en el padrón (no solo si Rules Engine agregó `convenio_multilateral`). La forma más simple es verificar si `padron.regimenGeneral.impuestos[]` contiene algún `idImpuesto` en `{5904, 5902, 5905, 5906, 215}` — la misma lógica que ya está en `_IMPUESTO_TO_OBLIGACION`. Esto evita acoplar el matching al RulesOutput.

Como alternativa más simple: la función puede recibir directamente `provincias: list[str]` y `registro_impuestos: list[RegistroImpuesto]`, y asumir que si `len(provincias) >= 2` ya hay convenio (esto lo decide el cliente al configurarlo). La verificación de IIBB en WS API es un check adicional de validación.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `fiscal_agent/models.py` | Modified | Nuevo modelo `RentasCordobaMatching` |
| `fiscal_agent/matching.py` | New | Función `evaluar_rentas_cordoba()` |
| `fiscal_agent/cli.py` | Modified | Invocar matching entre browser tasks y PDF |
| `fiscal_agent/pdf_generator.py` | Modified | Nuevo parámetro + método `_build_rentas_cordoba_placeholder()` |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| **False positive**: contribuyente con Convenio Multilateral + IIBB Córdoba pero sin operaciones en Córdoba (e.g. tiene Córdoba en RUT por registro histórico, no por actividad actual) | Low | El matching es conservador — solo activa placeholder, no afecta cálculos ni bloquea el pipeline. El contador puede ignorar la página extra |
| **False negative**: contribuyente con IIBB Córdoba no detectado porque el texto en RUT cambió (ej. "REG. GENERAL IIBB CORDOBA" pasa a "IIBB RG CBA") | Med | El matching usa substring/flexible matching (`"CORDOBA" in impuesto.upper()`) en vez de igualdad exacta. Fácil de ajustar en `matching.py` |
| **RegistroOutput sin impuestos**: si RegistroTask falla o no corre (`--with-registro` no se usó), el matching no puede evaluar Córdoba | Low | `evaluar_rentas_cordoba()` retorna `requiere_integracion=False` si faltan datos, con `tiene_iibb_cordoba=None` para indicar dato faltante |
| **Acoplamiento entre matching y rules engine**: validar IIBB en dos lugares distintos (WS API + RegistroOutput) puede dar resultados inconsistentes | Med | El matching está diseñado como función pura con inputs explícitos; si hay discrepancia se puede debuggear comparando `impuestos_ws` vs `registro_impuestos` |

## Rollback Plan

Cambio 100% aditivo — no modifica modelos existentes ni quita funcionalidad. Rollback:

1. `git revert` del commit que agrega `matching.py` y modifica `models.py`, `cli.py`, `pdf_generator.py`
2. O alternativamente: eliminar `fiscal_agent/matching.py`, revertir `models.py` (quitar `RentasCordobaMatching`), revertir `cli.py` y `pdf_generator.py` al estado anterior
3. Sin migración de datos — el modelo nuevo solo se usa en runtime, no persiste

## Dependencies

- Ninguna externa. Depende de que `RegistroTask` (ya implementado en Composio Browser) produzca `RegistroOutput.impuestos[]` correctamente poblado.
- Depende del flag `--with-registro` en CLI para que los datos de RUT estén disponibles.

## Success Criteria

- [ ] `evaluar_rentas_cordoba()` retorna `requiere_integracion=True` para contribuyentes con 2+ provincias + IIBB en WS API + "REG. GENERAL IIBB CORDOBA" en registro tributario
- [ ] `evaluar_rentas_cordoba()` retorna `requiere_integracion=False` si falta cualquiera de las condiciones
- [ ] PDF muestra placeholder "Rentas Córdoba — en desarrollo" + link cuando `requiere_integracion=True`
- [ ] PDF **no** muestra placeholder cuando `requiere_integracion=False`
- [ ] Pipeline no falla si `RegistroOutput` no está disponible (matching graceful)
- [ ] `python -m fiscal_agent run --with-registro --with-deuda --with-facilidades` produce PDF correcto para clientes con y sin matching positivo
