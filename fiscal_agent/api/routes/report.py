"""GET /v1/taxpayer/{cuit} + POST /v1/report — perfil y pipeline completo."""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from fiscal_agent.api.auth import ScopeRequired
from fiscal_agent.api.deps import CERT_PATH, KEY_PATH, REPRESENTANTE_CUIT, get_engine, get_pdf_gen, get_ta
from fiscal_agent.arca_ws import consultar_cuit, obtener_ta
from fiscal_agent.cli import _completar_cliente_desde_padron
from fiscal_agent.models import (
	ApiError,
	AppConfig,
	ClientConfig,
	PadronA5Output,
	RulesOutput,
	Scope,
	UnifiedResponse,
)

router = APIRouter()


@router.get('/v1/taxpayer/{cuit}')
async def get_taxpayer(
	cuit: str,
	_: None = Depends(ScopeRequired(Scope.TAXPAYER_READ)),
):
	"""Get taxpayer profile from Padrón A5.

	Returns structured data from ARCA's registration database.
	"""
	token, sign = get_ta()
	if not token or not sign:
		return UnifiedResponse(
			status='error',
			error=ApiError(
				code='TA_UNAVAILABLE',
				cause='No se pudo obtener Ticket de Acceso de ARCA',
				'remediation': 'Verificar certificados en .certificados-arca/',
			),
		)

	try:
		padron_result = consultar_cuit(cuit, token, sign, REPRESENTANTE_CUIT)
		output = padron_result.to_output()
	except Exception as exc:
		return UnifiedResponse(
			status='error',
			error=ApiError(
				code='TAXPAYER_QUERY_FAILED',
				cause=str(exc),
				'remediation': 'Verificar que el CUIT sea válido',
			),
		)

	if output.errorConstancia:
		errors = '; '.join(output.errorConstancia.error)
		return UnifiedResponse(
			status='error',
			error=ApiError(
				code='TAXPAYER_NOT_FOUND',
				cause=errors,
				'remediation': 'Verificar el CUIT consultado',
			),
		)

	return UnifiedResponse(
		status='success',
		result=output,
	)


class ReportRequest(BaseModel):
	"""Request body for POST /v1/report — full pipeline."""

	cuit: str
	mes: int
	anio: int
	with_deuda: bool = False
	with_facilidades: bool = False
	with_registro: bool = False
	send_email: bool = False
	idempotency_key: Optional[str] = None


@router.post('/v1/report')
async def report(
	request: ReportRequest,
	_: None = Depends(ScopeRequired(Scope.REPORT_WRITE)),
):
	"""Run the full fiscal pipeline: calendar + browser + PDF + email.

	Reuses ``_procesar_cliente_pipeline`` from the CLI.
	"""
	token, sign = get_ta()
	if not token or not sign:
		return UnifiedResponse(
			status='error',
			error=ApiError(
				code='TA_UNAVAILABLE',
				cause='No se pudo obtener Ticket de Acceso de ARCA',
				'remediation': 'Verificar certificados en .certificados-arca/',
			),
		)

	# Build a minimal ClientConfig for the pipeline
	cliente = ClientConfig(cuit=request.cuit)
	try:
		cliente = _completar_cliente_desde_padron(cliente, token, sign, REPRESENTANTE_CUIT)
	except Exception as exc:
		return UnifiedResponse(
			status='error',
			error=ApiError(
				code='TAXPAYER_QUERY_FAILED',
				cause=str(exc),
			),
		)

	# Init engine + pdf
	engine = get_engine()
	pdf_gen = get_pdf_gen()

	# Browser (lazy import, solo si es necesario)
	browser = None
	usa_browser = request.with_deuda or request.with_facilidades or request.with_registro
	if usa_browser:
		composio_key = os.environ.get('COMPOSIO_API_KEY', '')
		estudio_clave = os.environ.get('ESTUDIO_CLAVE_FISCAL', '')
		if not composio_key or not estudio_clave:
			return UnifiedResponse(
				status='error',
				error=ApiError(
					code='BROWSER_CONFIG_MISSING',
					cause='Falta COMPOSIO_API_KEY o ESTUDIO_CLAVE_FISCAL en .env',
				),
			)
		from fiscal_agent.browser import ComposioBrowser

		browser = ComposioBrowser(
			composio_api_key=composio_key,
			estudio_cuit=REPRESENTANTE_CUIT,
			estudio_clave=estudio_clave,
		)

	# Embed the flags into a _procesar_cliente_pipeline compatible way
	# We build a minimal AppConfig for SMTP access
	from pathlib import Path
	import yaml

	config_raw = {}
	config_path = Path('clients.yaml')
	if config_path.exists():
		config_raw = yaml.safe_load(config_path.read_text())
		config = AppConfig(**config_raw) if config_raw.get('smtp') else None
	else:
		config = None

	# We reuse the CLI's pipeline function directly
	from fiscal_agent.cli import _procesar_cliente_pipeline

	resultado = _procesar_cliente_pipeline(
		cliente=cliente,
		token=token,
		sign=sign,
		engine=engine,
		pdf_gen=pdf_gen,
		mes=request.mes,
		anio=request.anio,
		browser=browser,
		with_deuda=request.with_deuda,
		with_facilidades=request.with_facilidades,
		with_registro=request.with_registro,
		send_email=request.send_email,
		config=config,
	)

	if resultado.get('error'):
		return UnifiedResponse(
			status='error',
			error=ApiError(code='PIPELINE_FAILED', cause=resultado['error']),
		)

	next_actions = []
	if not request.send_email and resultado.get('pdf_path'):
		if cliente.email:
			next_actions.append('send_email')
		else:
			next_actions.append('configure_email')

	return UnifiedResponse(
		status='success',
		result={
			'pdf_path': str(resultado.get('pdf_path')) if resultado.get('pdf_path') else None,
			'email_sent': resultado.get('email', False),
			'ws_api': resultado.get('ws_api', False),
			'calendario': resultado.get('calendario', False),
		},
		next_actions=next_actions,
		human_approval_required=bool(next_actions),
	)
