"""POST /v1/calendar — generar calendario fiscal para un CUIT + período."""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from fiscal_agent.api.auth import ScopeRequired
from fiscal_agent.api.deps import REPRESENTANTE_CUIT, get_engine, get_ta
from fiscal_agent.arca_ws import consultar_cuit
from fiscal_agent.models import ApiError, RulesOutput, Scope, UnifiedResponse

router = APIRouter()


class CalendarRequest(BaseModel):
	"""Request body for POST /v1/calendar."""

	cuit: str
	mes: int
	anio: int
	idempotency_key: Optional[str] = None


@router.post('/v1/calendar')
async def calendar(
	request: CalendarRequest,
	_: None = Depends(ScopeRequired(Scope.CALENDAR_READ)),
):
	"""Generate fiscal calendar for a taxpayer CUIT + period.

	Reuses the existing RulesEngine + Padrón A5 WS API.
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

	# 1. Consultar padrón A5
	try:
		padron_result = consultar_cuit(request.cuit, token, sign, REPRESENTANTE_CUIT)
		output = padron_result.to_output()
	except Exception as exc:
		return UnifiedResponse(
			status='error',
			error=ApiError(
				code='TAXPAYER_QUERY_FAILED',
				cause=str(exc),
				'remediation': 'Verificar que el CUIT sea válido y que el servicio ARCA esté disponible',
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

	# 2. Calcular calendario
	engine = get_engine()
	try:
		calendario = engine.calcular(output, request.mes, request.anio)
	except Exception as exc:
		return UnifiedResponse(
			status='error',
			error=ApiError(
				code='CALENDAR_FAILED',
				cause=str(exc),
				'remediation': 'Error interno del motor de reglas',
			),
		)

	return UnifiedResponse(
		status='success',
		result=calendario,
	)
