# Design: report-command

## Technical Approach

Comando Typer interactivo que reutiliza la lógica del pipeline single-cliente de `run` extrayéndola a una función compartida `_procesar_cliente_pipeline()`. El flujo interactivo (CUIT → lookup → descubrimiento opcional → selección de tasks) son helpers nuevos; las etapas WS API → Rules → Composio → Matching → PDF son la misma lógica que `run` sin duplicación.

## Architecture Decisions

| Option | Tradeoff | Decision |
|--------|----------|----------|
| Extraer `_procesar_cliente_pipeline()` compartida | Duplicación cero; refactor mínimo de `run` (mueve ~50 líneas a helper, `run` lo llama igual) | ✅ **Elegido** |
| Copiar pipeline inline en `report` | Rápido pero viola "NO duplicar" | ❌ Rechazado |
| Descubrimiento escribe YAML a disco | Race condition, riesgo de corrupción | ❌ Rechazado — solo runtime `config.clientes.append()` |

| Decision | Rationale |
|----------|-----------|
| **Discovery no escribe YAML** | El usuario debe agregar manualmente el nuevo cliente al YAML. El spec (línea 75) es explícito: "no escribe el YAML a disco". |
| **`output_dir` en `generar()`, no en `__init__()`** | Cambio mínimo (~10 líneas). El comando `run` no se toca — llama `generar()` sin `output_dir`, sigue usando `self.output_dir`. |
| **Errores no abortan el comando** | Igual que `run`: Composio falla → sigue a resumen sin PDF; sin vencimientos → saltea PDF y email. El usuario ve el error al final. |

## Data Flow

```
┌─ CLI prompt ─────────────────────────────────────────────────────────┐
│                                                                       │
│  CUIT (11 dígitos)                                                    │
│     │                                                                 │
│     ▼                                                                 │
│  Lookup en clients.yaml                    ──→  Encontrado → mostrar  │
│     │                                           datos del cliente    │
│     ▼ No encontrado                                                  │
│  ¿Descubrir? ── No → exit                                            │
│     │ Sí                                                             │
│     ▼                                                                │
│  Obtener TA → Padrón A5 → mostrar datos → pedir email/clave          │
│     → agregar a config.clientes (runtime)                            │
│                                                                       │
│  Seleccionar tasks (deuda/facilidades/registro)                      │
│                                                                       │
│  ┌─ Pipeline compartido ─────────────────────────────────────────┐   │
│  │  WS API → Auto-complete → Rules Engine → Composio (tasks)    │   │
│  │  → Matching → PDF (con output_dir=storage/YYYY-MM/)          │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                       │
│  ¿Enviar email?                                                      │
│                                                                       │
│  Resumen                                                             │
└───────────────────────────────────────────────────────────────────────┘
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `fiscal_agent/cli.py` | Modify | + comando `report`, + helper `_procesar_cliente_pipeline()` (extraído de `run`), + helpers interactivos |
| `fiscal_agent/pdf_generator.py` | Modify | `generar()` acepta `output_dir: Optional[Path] = None` |

## Interfaces / Contracts

### PdfGenerator.generar() — cambio mínimo

```python
def generar(
    self,
    nombre: str,
    cuit: str,
    vtos: List[Vencimiento],
    mes: int,
    anio: int,
    observaciones: Optional[List[str]] = None,
    deuda: Optional[DeudaOutput] = None,
    rentas_matching: Optional[RentasCordobaMatching] = None,
    output_dir: Optional[Path] = None,      # ← NUEVO
) -> Path:
    dest = output_dir if output_dir is not None else self.output_dir
    filepath = dest / filename
    dest.mkdir(parents=True, exist_ok=True)  # ← movido acá (ya existe en __init__)
    # ... resto igual
```

El `mkdir()` ya está en `__init__` — se mantiene para `self.output_dir`. El `dest.mkdir()` adicional solo corre cuando `output_dir` se pasa explícitamente (idempotente).

### _procesar_cliente_pipeline() — extraído de `run` (líneas 396-518)

```python
def _procesar_cliente_pipeline(
    cliente: ClientConfig,
    token: str,
    sign: str,
    engine: RulesEngine,
    browser: Optional[ComposioBrowser],
    mes: int,
    anio: int,
    with_deuda: bool,
    with_facilidades: bool,
    with_registro: bool,
    pdf_gen: PdfGenerator,
    output_dir: Optional[Path] = None,
) -> dict:
    """Pipeline single-cliente. Retorna dict con resultado + pdf_path.
    
    Reutilizado por ``run`` y ``report``. No maneja email —
    cada comando lo hace a su manera.
    """
```

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | `generar(output_dir=...)` | Mock `SimpleDocTemplate`, verificar que `filepath` usa `dest / filename` |
| Unit | Validación CUIT (11 dígitos, vacío, con guiones) | Tests directos de `_validar_cuit()` |
| Integration | `_procesar_cliente_pipeline()` con pipeline real | Same tests que `run` — el helper es el mismo código |
| E2E | `python -m fiscal_agent report` | Simular input con `typer.prompt()` mockeado |

## Migration / Rollout

No migration required. El comando `run` no se modifica en su comportamiento — solo se refactoriza internamente. Tests existentes de `run` pasan igual.

## Open Questions

None.

---

## Pseudocódigo — helpers y comando `report`

```python
# ── Helpers ──────────────────────────────────────────────────────────

def _validar_cuit() -> str:
    """Prompt interactivo con validación 11 dígitos."""
    while True:
        cuit = typer.prompt('CUIT del cliente').strip()
        if not cuit:
            typer.echo('Operación cancelada.')
            raise typer.Exit(0)
        if re.match(r'^\d{11}$', cuit):
            return cuit
        typer.echo('❌ CUIT inválido — debe tener 11 dígitos')


def _descubrir_cliente(cuit: str) -> ClientConfig:
    """Descubrimiento inline: TA → Padrón A5 → prompts → ClientConfig."""
    # Verificar certificados
    if not CERT_PATH.exists() or not KEY_PATH.exists():
        typer.echo('❌ Certificados no encontrados')
        raise typer.Exit(1)
    # Obtener TA
    token, sign = obtener_ta('ws_sr_constancia_inscripcion', str(CERT_PATH), str(KEY_PATH))
    # Consultar padrón
    result = consultar_cuit(cuit, token, sign, REPRESENTANTE_CUIT)
    output = result.to_output()
    if output.errorConstancia:
        typer.echo('❌ Error en constancia:')
        for e in output.errorConstancia.error:
            typer.echo(f'   • {e}')
        raise typer.Exit(1)
    extraer_datos_y_mostrar(output)
    email = typer.prompt('Email del cliente', default='')
    clave_fiscal = typer.prompt('Clave fiscal ARCA', default='')
    return ClientConfig(cuit=cuit, email=email, clave_fiscal=clave_fiscal,
                        nombre=nombre, tipo=tipo, tipo_persona=tipo_persona,
                        cierre_ejercicio=cierre, provincias=provincias)


def _seleccionar_tasks() -> tuple[bool, bool, bool]:
    """Loop interactivo hasta que al menos una task esté seleccionada."""
    while True:
        d = typer.confirm('¿Extraer deuda ARCA?', default=True)
        f = typer.confirm('¿Extraer facilidades?', default=False)
        r = typer.confirm('¿Extraer registro tributario?', default=False)
        if d or f or r:
            return d, f, r
        typer.echo('⚠️  Debe seleccionar al menos una task.')


def _procesar_cliente_pipeline(...) -> dict:
    """Pipeline single-cliente (extraído de run). Retorna dict con resultado."""
    # Ver código existente de run, líneas ~396-518
    # WS API → Auto-complete → Rules → Composio → Matching → PDF
    # Retorna: {cliente, cuit, ws_api, calendario, pdf, pdf_path, error, browser_failed}


def _preguntar_email(cliente: ClientConfig, pdf_path: Optional[Path],
                      config: AppConfig, mes: int, anio: int) -> str:
    """Prompt interactivo de email. Retorna string de estado."""
    if not pdf_path:
        return 'Omitido (no hay PDF generado)'
    if not cliente.email:
        return 'Sin email configurado'
    if typer.confirm(f'¿Enviar email a {cliente.email}?', default=False):
        ok = EmailSender(config.smtp).enviar(cliente, pdf_path, mes, anio)
        return f'{"✅ Enviado" if ok else "❌ Error"}'


# ── Comando ─────────────────────────────────────────────────────────

@app.command()
def report(headed: bool = typer.Option(False, '--headed')) -> None:
    now = datetime.now()
    load_dotenv()
    logging.basicConfig(level=logging.INFO, format='%(message)s', force=True)

    # Cargar config
    raw = yaml.safe_load(DEFAULT_CONFIG.read_text())
    config = AppConfig(**raw)

    # CUIT
    cuit = _validar_cuit()
    cliente = next((c for c in config.clientes if c.cuit == cuit), None)

    # Descubrimiento
    if not cliente:
        if typer.confirm(f'CUIT {cuit} no encontrado. ¿Descubrir desde Padrón A5?', default=False):
            cliente = _descubrir_cliente(cuit)
            config.clientes.append(cliente)
        else:
            typer.echo('❌ CUIT no registrado.')
            raise typer.Exit(1)

    typer.echo(f'✅ Cliente: {cliente.nombre or cliente.cuit} | {cliente.email or "sin email"}')

    # Tasks
    with_deuda, with_facilidades, with_registro = _seleccionar_tasks()

    # Early validation
    if with_deuda or with_facilidades or with_registro:
        if not os.environ.get('COMPOSIO_API_KEY') or not os.environ.get('ESTUDIO_CLAVE_FISCAL'):
            typer.echo('❌ COMPOSIO_API_KEY o ESTUDIO_CLAVE_FISCAL no configuradas')
            raise typer.Exit(1)

    # Output dir del mes
    output_dir = Path(f'storage/{now.year:04d}-{now.month:02d}')

    # Pipeline
    engine = RulesEngine()
    pdf_gen = PdfGenerator()
    # ... init certs, TA, browser, etc. (misma lógica que run líneas 362-390)
    resultado = _procesar_cliente_pipeline(cliente, token, sign, engine, browser,
                                            now.month, now.year,
                                            with_deuda, with_facilidades, with_registro,
                                            pdf_gen, output_dir=output_dir)

    # Email
    email_status = _preguntar_email(cliente, resultado.get('pdf_path'), config,
                                     now.month, now.year)
    # Resumen
    _mostrar_resumen(cliente, resultado, email_status)
```

## Error Handling Matrix

| Scenario | Behavior |
|----------|----------|
| CUIT vacío | Sale con `typer.Exit(0)` |
| CUIT ≠ 11 dígitos | Re-prompt, no sale |
| CUIT no encontrado + decline | Sale con `typer.Exit(1)` |
| Descubrimiento → errorConstancia | Sale con `typer.Exit(1)` |
| Missing env vars (browser) | Sale con `typer.Exit(1)` |
| Composio timeout/error | Muestra `⚠️`, continúa sin PDF |
| Sin vencimientos | Saltea PDF y email, muestra en resumen |
| Email falla | Muestra `❌`, comando continúa |
