"""GET /v1/health — health check endpoint."""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter

from fiscal_agent.api.deps import get_ta
from fiscal_agent.models import ApiError, UnifiedResponse

router = APIRouter()


@router.get('/v1/health')
async def health():
	"""Health check. Returns server status, timestamp, and TA validity."""
	token, _ = get_ta()

	return UnifiedResponse(
		status='success',
		result={
			'status': 'healthy',
			'timestamp': datetime.now().isoformat(),
			'ta_vigente': token is not None,
		},
	)
