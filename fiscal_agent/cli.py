"""Fiscal agent CLI — pipeline orchestration.

Usage:
        python -m fiscal_agent run --config clients.yaml
        python -m fiscal_agent validate [config_path]
        python -m fiscal_agent generate-template [output_path]
"""

from __future__ import annotations

import asyncio
import logging
import os
from datetime import datetime
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv
import typer
import yaml

from fiscal_agent.arca_ws import consultar_cuit, obtener_ta
from fiscal_agent.email_sender import EmailSender
from fiscal_agent.models import AppConfig, ClientConfig, TipoContribuyente, TipoPersona
from fiscal_agent.pdf_generator import PdfGenerator
from fiscal_agent.rules_engine import RulesEngine

logger = logging.getLogger(__name__)

app = typer.Typer(
	name='fiscal-agent',
	help='Vertical AI Agent Fiscal — calendario de vencimientos ARCA',
)

# ── Paths ───────────────────────────────────────────────────────────────────────

DEFAULT_CONFIG = Path('clients.yaml')
CERT_DIR = Path('.certificados-arca')
CERT_PATH = CERT_DIR / 'produccion.crt'
KEY_PATH = CERT_DIR / 'produccion.key'
REPRESENTANTE_CUIT = os.environ.get('ESTUDIO_CUIT', '20324837796')  # CUIT del estudio/representante


# ── Helper: auto-deducción desde Padrón A5 ──────────────────────────────────────


def _completar_cliente_desde_padron(
	cliente: ClientConfig,
	token: str,
	sign: str,
	representante_cuit: str,
) -> ClientConfig:
	"""Completa campos faltantes de ClientConfig desde Padrón A5.

	Solo consulta el WS si al menos uno de los campos deducibles
	(``nombre``, ``tipo``, ``tipo_persona``, ``cierre_ejercicio``)
	está ausente.
	"""
	# Si ya está completo, no consultar
	if all(
		[
			cliente.nombre,
			cliente.tipo,
			cliente.tipo_persona,
			cliente.cierre_ejercicio,
		]
	):
		return cliente

	result = consultar_cuit(cliente.cuit, token, sign, representante_cuit)
	output = result.to_output()
	output_dict = result.to_dict()

	# ── Error de constancia ──────────────────────────────────────────────
	if output.errorConstancia:
		raise ValueError(f'Error al consultar CUIT {cliente.cuit}: {"; ".join(output.errorConstancia.error)}')

	# ── Nombre / Razón social ────────────────────────────────────────────
	nombre = output_dict.get('nombre') or ''
	if not nombre and output.datosGenerales:
		nombre = (
			output.datosGenerales.razonSocial
			or f'{output.datosGenerales.nombre or ""} {output.datosGenerales.apellido or ""}'.strip()
		)
	nombre = nombre or cliente.cuit

	# ── Provincia del domicilio fiscal ────────────────────────────────────
	provincia = None
	if output.domicilioFiscal and output.domicilioFiscal.descripcionProvincia:
		provincia = output.domicilioFiscal.descripcionProvincia

	return ClientConfig(
		cuit=cliente.cuit,
		clave_fiscal=cliente.clave_fiscal,
		email=cliente.email,
		nombre=cliente.nombre or nombre,
		tipo=cliente.tipo or TipoContribuyente(output_dict.get('tipo')),
		tipo_persona=cliente.tipo_persona
		or (TipoPersona.fisica if output_dict.get('tipo_persona', '').upper() == 'FISICA' else TipoPersona.juridica),
		cierre_ejercicio=cliente.cierre_ejercicio or output_dict.get('mes_cierre'),
		provincias=(cliente.provincias or ([provincia] if provincia else None)),
	)


# ── Commands ────────────────────────────────────────────────────────────────────


@app.command()
def validate(
	config_path: Path = typer.Argument(
		DEFAULT_CONFIG,
		help='Ruta al archivo clients.yaml',
		exists=True,
	),
) -> None:
	"""Validate clients.yaml against Pydantic models."""
	raw = yaml.safe_load(config_path.read_text())
	config = AppConfig(**raw)
	typer.echo(f'Config valida: {len(config.clientes)} cliente(s), SMTP en {config.smtp.host}')
	for c in config.clientes:
		prov = ', '.join(c.provincias) if c.provincias else '(sin especificar)'
		nombre = c.nombre or c.cuit
		tipo_str = c.tipo.value if c.tipo else '—(pendiente)—'
		typer.echo(f'  {c.cuit} | {nombre:30s} | {tipo_str:20s} | {prov}')
		if not c.email:
			typer.echo(f'  ⚠️   Falta email para {nombre}')
		if c.tipo is not None and c.tipo != 'monotributo' and not c.clave_fiscal:
			typer.echo(f'  ⚠️   Falta clave_fiscal para {nombre} (necesaria para browser-use)')


@app.command()
def generate_template(
	output: Path = typer.Argument(
		Path('clientes_para_completar.csv'),
		help='Ruta de salida del CSV',
	),
) -> None:
	"""Generate a CSV template for the accountant to fill in."""
	import csv

	fields = [
		'cuit',
		'clave_fiscal',
		'tipo',
		'tipo_persona',
		'email',
		'cierre_ejercicio',
		'provincias',
	]

	with output.open('w', newline='') as f:
		writer = csv.writer(f)
		writer.writerow(fields)
		writer.writerow(
			[
				'30716395541',
				'Pablo20325',
				'responsable_inscripto',
				'juridica',
				'cliente@ejemplo.com',
				'12',
				'CABA',
			]
		)
		writer.writerow(
			[
				'33718532669',
				'',
				'responsable_inscripto',
				'juridica',
				'',
				'12',
				'CABA, Buenos Aires',
			]
		)

	typer.echo(f'Template generado: {output}')
	typer.echo('Completar: clave_fiscal, email, provincias de cada cliente')


@app.command()
def discover(
	cuit: str = typer.Argument(..., help='CUIT a consultar en el Padrón A5'),
) -> None:
	"""Consultar Padrón A5 y deducir datos de un cliente interactivamente."""
	load_dotenv()

	# 1. Verificar certificados
	if not CERT_PATH.exists() or not KEY_PATH.exists():
		typer.echo('Error: certificados no encontrados en .certificados-arca/')
		raise typer.Exit(1)

	# 2. Obtener TA
	typer.echo('Obteniendo TA ...')
	token, sign = obtener_ta(
		'ws_sr_constancia_inscripcion',
		str(CERT_PATH),
		str(KEY_PATH),
	)
	typer.echo(f'TA vigente: {token[:40]}...')
	typer.echo()

	# 3. Consultar padrón
	typer.echo(f'Consultando CUIT {cuit} ...')
	result = consultar_cuit(cuit, token, sign, REPRESENTANTE_CUIT)
	output = result.to_output()
	output_dict = result.to_dict()

	# Verificar errores
	if output.errorConstancia:
		typer.echo('❌ Error en la consulta:')
		for e in output.errorConstancia.error:
			typer.echo(f'   • {e}')
		raise typer.Exit(1)

	# 4. Mostrar datos deducidos
	tipo = output_dict.get('tipo', '')
	tipo_persona = output_dict.get('tipo_persona', '')
	cierre = output_dict.get('mes_cierre', 12)
	provincia = output_dict.get('provincia', '')

	# Nombre: prefiere razon_social para jurídicas, nombre+apellido para físicas
	nombre = (
		output_dict.get('razon_social')
		or output_dict.get('nombre')
		or f'{output_dict.get("nombre", "")} {output_dict.get("apellido", "")}'.strip()
		or cuit
	)

	typer.echo()
	typer.echo('═' * 50)
	typer.echo('  DATOS DEDUCIDOS DEL PADRÓN A5')
	typer.echo('═' * 50)
	typer.echo(f'  CUIT:             {cuit}')
	typer.echo(f'  Nombre/Razón Soc: {nombre}')
	typer.echo(f'  Tipo:             {tipo}')
	typer.echo(f'  Tipo persona:     {tipo_persona}')
	typer.echo(f'  Cierre ejercicio: {cierre}')
	typer.echo(f'  Provincia fiscal: {provincia}')
	typer.echo('═' * 50)
	typer.echo()

	# 5. Pedir solo lo que ARCA no sabe
	email = typer.prompt('Email del cliente', default='')
	clave_fiscal = typer.prompt('Clave fiscal ARCA', default='')

	# Provincia se deduce del padrón (domicilio fiscal).
	# Si opera en más, se edita manual en clients.yaml después.
	provincias = [provincia] if provincia else []

	# 6. Mostrar bloque YAML
	typer.echo()
	typer.echo('═' * 50)
	typer.echo('  BLOQUE YAML — copialo en clients.yaml')
	typer.echo('═' * 50)
	typer.echo(f'  - cuit: {cuit}')
	typer.echo(f'    clave_fiscal: "{clave_fiscal}"')
	typer.echo(f'    email: "{email}"')
	typer.echo(f'    nombre: "{nombre}"')
	typer.echo(f'    tipo: {tipo}')
	if tipo_persona:
		typer.echo(f'    tipo_persona: {tipo_persona}')
	typer.echo(f'    cierre_ejercicio: {cierre}')
	if provincias:
		typer.echo(f'    provincias: [{", ".join(provincias)}]')
	else:
		typer.echo('    provincias: []')
	typer.echo('═' * 50)
	typer.echo()
	typer.echo('📋 Copiá ese bloque y pegálo en clients.yaml bajo clientes:')
	typer.echo()


@app.command()
def run(
	config_path: Path = typer.Option(
		DEFAULT_CONFIG,
		'--config',
		'-c',
		help='Ruta al archivo clients.yaml',
		exists=True,
	),
	mes: Optional[int] = typer.Option(
		None,
		'--mes',
		'-m',
		help='Mes a calcular (1-12). Default: mes actual',
	),
	anio: Optional[int] = typer.Option(
		None,
		'--anio',
		'-a',
		help='Año (e.g. 2026). Default: año actual',
	),
	send_email: bool = typer.Option(
		True,
		'--send/--no-send',
		help='Enviar email con el PDF',
	),
	with_deuda: bool = typer.Option(
		False,
		'--with-deuda',
		'-d',
		help='Extraer deuda real vía Composio Browser para cada cliente',
	),
	with_facilidades: bool = typer.Option(
		False,
		'--with-facilidades',
		'-f',
		help='Extraer planes de pago de Mis Facilidades ARCA',
	),
	with_registro: bool = typer.Option(
		False,
		'--with-registro',
		'-r',
		help='Extraer registro tributario IIBB e impuestos de ARCA',
	),
	headed: bool = typer.Option(
		False,
		'--headed',
		help='Mostrar URL en vivo del browser Composio (debug)',
	),
) -> None:
	"""Run the full pipeline for all clients.

	Pipeline: WS API → Rules Engine → PDF → Email (opcional)
	Con --with-deuda: agrega Composio Browser (ctacte.cloud) entre Rules Engine y PDF.
	Con --with-facilidades: agrega planes de pago de Mis Facilidades ARCA.
	Con --with-registro: agrega registro tributario IIBB e impuestos.
	"""
	now = datetime.now()
	mes = mes or now.month
	anio = anio or now.year

	# Load .env before anything else
	load_dotenv()

	# Configurar logging: INFO para ver task boundaries, formato limpio
	logging.basicConfig(level=logging.INFO, format='%(message)s', force=True)

	typer.echo(f'🚀 Pipeline fiscal — {mes:02d}/{anio}')
	typer.echo(f'   Config: {config_path}')
	typer.echo()

	# 0. Early validation for browser flags
	usa_browser = with_deuda or with_facilidades or with_registro
	if usa_browser:
		composio_api_key = os.environ.get('COMPOSIO_API_KEY', '')
		if not composio_api_key:
			typer.echo('❌ COMPOSIO_API_KEY no configurada en .env')
			raise typer.Exit(1)
		estudio_clave = os.environ.get('ESTUDIO_CLAVE_FISCAL', '')
		if not estudio_clave:
			typer.echo('❌ ESTUDIO_CLAVE_FISCAL no configurada en .env')
			raise typer.Exit(1)

	# 1. Load config
	raw = yaml.safe_load(config_path.read_text())
	config = AppConfig(**raw)
	typer.echo(f'Clientes: {len(config.clientes)}')

	# 2. Init engine
	engine = RulesEngine()
	pdf_gen = PdfGenerator()

	# 3. Load certs
	if not CERT_PATH.exists() or not KEY_PATH.exists():
		typer.echo('Error: certificados no encontrados en .certificados-arca/')
		raise typer.Exit(1)

	# 4. Get TA (reusable for all clients — same representante)
	typer.echo('Obteniendo TA ...')
	token, sign = obtener_ta(
		'ws_sr_constancia_inscripcion',
		str(CERT_PATH),
		str(KEY_PATH),
	)
	typer.echo(f'TA vigente: {token[:40]}...')
	typer.echo()

	# 5. Init browser (deferred import — solo si --with-deuda o --with-facilidades)
	browser = None
	if usa_browser:
		from fiscal_agent.browser import ComposioBrowser

		browser = ComposioBrowser(
			composio_api_key=composio_api_key,
			estudio_cuit=REPRESENTANTE_CUIT,
			estudio_clave=estudio_clave,
			headed=headed,
		)

	# 6. Process each client
	resultados: list[dict] = []
	for i, cliente in enumerate(config.clientes, 1):
		typer.echo(f'── [{i}/{len(config.clientes)}] {cliente.nombre or cliente.cuit} ({cliente.cuit}) ──')
		resultado = {
			'cliente': cliente.nombre or cliente.cuit,
			'cuit': cliente.cuit,
			'ws_api': False,
			'calendario': False,
			'pdf': False,
			'email': False,
			'error': None,
		}

		try:
			# ── WS API ──────────────────────────────────────────────────────
			typer.echo('  Consultando Padrón A5 ...')
			padron_result = consultar_cuit(cliente.cuit, token, sign, REPRESENTANTE_CUIT)
			output = padron_result.to_output()
			resultado['ws_api'] = True
			typer.echo(f'  Tipo: {output.datosGenerales.tipoPersona or "N/A"}')

			# ── Auto-complete missing fields from Padrón A5 ────────────────
			cliente = _completar_cliente_desde_padron(cliente, token, sign, REPRESENTANTE_CUIT)
			resultado['cliente'] = cliente.nombre or cliente.cuit
			if cliente.nombre:
				typer.echo(f'  Nombre: {cliente.nombre}')

			# ── Rules Engine ────────────────────────────────────────────────
			typer.echo('  Calculando calendario ...')
			calendario = engine.calcular(output, mes, anio, provincias=cliente.provincias)
			n = len(calendario.vencimientos)
			resultado['calendario'] = True
			typer.echo(f'  Vencimientos: {n}')

			if n == 0:
				typer.echo(f'  Sin vencimientos para {cliente.nombre or cliente.cuit} este mes')
				resultados.append(resultado)
				continue

			# ── Composio Browser (deuda + facilidades) ─────────────────────────
			deuda_output = None
			rentas_matching = None
			if usa_browser and browser is not None:
				from fiscal_agent.browser import FacilidadesTask, FullTask, RegistroTask

				tasks = []
				if with_deuda:
					tasks.append(
						FullTask(
							cuit=REPRESENTANTE_CUIT,
							clave=estudio_clave,
							cliente_cuit=cliente.cuit,
						)
					)
				if with_facilidades:
					tasks.append(
						FacilidadesTask(
							cuit=REPRESENTANTE_CUIT,
							clave=estudio_clave,
							cliente_cuit=cliente.cuit,
						)
					)
				if with_registro:
					tasks.append(
						RegistroTask(
							cuit=REPRESENTANTE_CUIT,
							clave=estudio_clave,
							cliente_cuit=cliente.cuit,
						)
					)

				typer.echo(f'  Extrayendo vía Composio ({len(tasks)} task(s)) ...')
				deuda_output = browser.run_single(cliente, tasks=tasks)
				if deuda_output.error:
					error_tag = 'TIMEOUT' if 'Timeout' in deuda_output.error else 'ERROR'
					typer.echo(f'  ⚠️  Composio: {error_tag} — {deuda_output.error}')
					logger.info('[%s] Composio: %s', cliente.cuit, error_tag)
				else:
					parts = []
					if deuda_output.saldos or deuda_output.deudas:
						parts.append(f'{len(deuda_output.deudas)} deudas')
					if deuda_output.facilidades:
						parts.append(f'{len(deuda_output.facilidades)} planes')
					if deuda_output.registro:
						r = deuda_output.registro
						dom_count = len(r.domicilios)
						act_count = len(r.actividades)
						imp_count = len(r.impuestos)
						pv_count = len(r.puntos_de_venta)
						parts.append(f'{dom_count} domicilios, {act_count} actividades, {imp_count} impuestos, {pv_count} PV')
					detalle = ', '.join(parts) if parts else 'OK'
					typer.echo(f'  ✅ Composio: {detalle}')
					logger.info('[%s] Composio: OK', cliente.cuit)

			# ── Determinar si browser falló (las tasks no extrajeron datos) ──
			browser_failed = deuda_output is not None and bool(deuda_output.error)

			# ── Rentas Córdoba Matching ──────────────────────────────────────
			if deuda_output is not None and not browser_failed:
				from fiscal_agent.matching import evaluar_rentas_cordoba

				rentas_matching = evaluar_rentas_cordoba(
					provincias=cliente.provincias,
					impuestos_ws=output.regimenGeneral.impuestos if output.regimenGeneral else None,
					registro_impuestos=deuda_output.registro.impuestos if deuda_output.registro else None,
				)
				if rentas_matching.requiere_integracion:
					typer.echo(f'  🔗 Matching: Rentas Córdoba (en desarrollo)')

			# ── PDF (solo si no hubo error de browser) ───────────────────────
			if not browser_failed:
				typer.echo('  Generando PDF ...')
				pdf_path = pdf_gen.generar(
					cliente.nombre,
					cliente.cuit,
					calendario.vencimientos,
					mes,
					anio,
					observaciones=calendario.observaciones or None,
					deuda=deuda_output,
					rentas_matching=rentas_matching,
				)
				resultado['pdf'] = True
				typer.echo(f'  PDF: {pdf_path}')
			else:
				typer.echo(f'  ⚠️  Browser: salteando PDF (error en extracción — {deuda_output.error})')

			# ── Email (solo si hay PDF generado) ─────────────────────────────
			if not browser_failed and send_email:
				if not cliente.email:
					typer.echo('  ⚠️  Sin email configurado — salteando envío')
				else:
					typer.echo(f'  Enviando email a {cliente.email} ...')
					sender = EmailSender(config.smtp)
					ok = sender.enviar(cliente, pdf_path, mes, anio)
					resultado['email'] = ok
					typer.echo(f'  Email: {"✅" if ok else "❌"}')
			elif not browser_failed:
				typer.echo('  Email: omitido (--no-send)')
			else:
				typer.echo('  Email: omitido (error en extracción)')

		except Exception as exc:
			resultado['error'] = str(exc)
			typer.echo(f'  ❌ Error: {exc}')

		resultados.append(resultado)
		typer.echo()

	# 6. Summary
	ok = sum(1 for r in resultados if r['error'] is None)
	typer.echo('═' * 50)
	typer.echo(f'Resumen: {ok}/{len(resultados)} clientes OK')
	for r in resultados:
		status = '✅' if r['error'] is None else '❌'
		parts = []
		if r['ws_api']:
			parts.append('WS API')
		if r['calendario']:
			parts.append('Calendario')
		if r['pdf']:
			parts.append('PDF')
		if r['email']:
			parts.append('Email')
		typer.echo(f'  {status} {r["cliente"]}: {", ".join(parts) if parts else r["error"]}')

	if any(r['error'] for r in resultados):
		typer.echo('⚠️  Algunos clientes tienen errores — revisar logs')
		raise typer.Exit(1)

	typer.echo('Pipeline completado exitosamente.')


@app.command()
def deuda(
	config_path: Path = typer.Option(
		DEFAULT_CONFIG,
		'--config',
		'-c',
		help='Ruta al archivo clients.yaml',
		exists=True,
	),
	headed: bool = typer.Option(
		False,
		'--headed',
		help='Mostrar navegador para debug',
	),
) -> None:
	"""Extraer deuda real vía browser automation (proveedor configurable).

	Requiere: ESTUDIO_CUIT y ESTUDIO_CLAVE_FISCAL en .env
	"""
	load_dotenv()
	raw = yaml.safe_load(config_path.read_text())
	config = AppConfig(**raw)

	estudio_clave = os.environ.get('ESTUDIO_CLAVE_FISCAL', '')
	if not estudio_clave:
		typer.echo('❌ ESTUDIO_CLAVE_FISCAL no configurada en .env')
		raise typer.Exit(1)

	# ═══════════════════════════════════════════════════════════════════
	# Browser provider — intercambiable
	# Hoy: ComposioBrowser (Composio Browser Tool vía REST API)
	# ═══════════════════════════════════════════════════════════════════
	composio_api_key = os.environ.get('COMPOSIO_API_KEY', '')
	if not composio_api_key:
		typer.echo('❌ COMPOSIO_API_KEY no configurada en .env')
		typer.echo('   Obtenela en https://dashboard.composio.dev/settings')
		raise typer.Exit(1)

	from fiscal_agent.browser import ComposioBrowser

	deuda_resultados: list[dict] = []
	extractor = ComposioBrowser(
		composio_api_key=composio_api_key,
		estudio_cuit=REPRESENTANTE_CUIT,
		estudio_clave=estudio_clave,
		headed=headed,
	)
	try:
		outputs = asyncio.run(extractor.run_all(config.clientes))
		nombres = {c.cuit: c.nombre for c in config.clientes}
		for out in outputs:
			status = 'error' if out.error else 'ok'
			deuda_resultados.append(
				{
					'cliente': nombres.get(out.cuit, out.cuit),
					'cuit': out.cuit,
					'status': status,
					'error': out.error,
				}
			)
			if out.error:
				typer.echo(f'  ❌ {out.cuit}: {out.error}')
			else:
				typer.echo(f'  ✅ {out.cuit}: login + extract OK')
	finally:
		asyncio.run(extractor.close())

	# Summary
	if deuda_resultados:
		typer.echo()
		ok_d = sum(1 for r in deuda_resultados if r['status'] == 'ok')
		typer.echo(f'Browser: {ok_d}/{len(deuda_resultados)} representados OK')
		for r in deuda_resultados:
			status_sym = '✅' if r['status'] == 'ok' else '❌'
			err = f' — {r["error"]}' if r['error'] else ''
			typer.echo(f'  {status_sym} {r["cliente"]} ({r["cuit"]}){err}')


def main() -> None:
	"""Entry point for ``python -m fiscal_agent``."""
	app()
