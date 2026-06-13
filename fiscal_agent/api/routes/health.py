"""GET /v1/health — health check endpoint."""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter

from fiscal_agent.api.deps import get_ta
from fiscal_agent.models import ApiError, UnifiedResponse

router = APIRouter()


@router.get(
	'/v1/health',
	response_model=UnifiedResponse[dict],
	summary='Health check del agente',
	responses={
		401: {'description': 'API key faltante o inválida', 'model': UnifiedResponse[ApiError]},
		403: {'description': 'Scope insuficiente o key inactiva', 'model': UnifiedResponse[ApiError]},
		429: {'description': 'Límite de tasa excedido', 'model': UnifiedResponse[ApiError]},
	},
)
async def health():
	"""Health check del agente. Retorna estado del servidor, timestamp y validez del Ticket de Acceso (TA) de ARCA."""
	token, _ = get_ta()

	return UnifiedResponse(
		status='success',
		result={
			'status': 'healthy',
			'timestamp': datetime.now().isoformat(),
			'ta_vigente': token is not None,
		},
	)
