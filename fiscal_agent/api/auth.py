"""API Key authentication and scope enforcement for FastAPI.

Usage::

    from fiscal_agent.api.auth import ScopeRequired
    from fiscal_agent.models import Scope


    @router.get('/v1/taxpayer/{cuit}')
    async def get_taxpayer(
        cuit: str,
        _: None = Depends(ScopeRequired(Scope.TAXPAYER_READ)),
    ): ...
"""

from __future__ import annotations

from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from fiscal_agent.api.store import resolve_api_key
from fiscal_agent.models import ApiError, Scope, UnifiedResponse

security = HTTPBearer(auto_error=False)


class ScopeRequired:
	"""FastAPI dependency that enforces API key auth + scope check.

	Usage::

	    @router.get('/v1/some-endpoint')
	    async def handler(
	        _: None = Depends(ScopeRequired(Scope.CALENDAR_READ)),
	    ): ...

	On success, populates ``request.state`` with:
	- ``developer``: Developer
	- ``app``: App
	- ``api_key``: ApiKey
	- ``plan``: Plan
	"""

	def __init__(self, scope: Scope):
		self.scope = scope

	async def __call__(self, request: Request, credentials: HTTPAuthorizationCredentials | None = Depends(security)):
		# ── Extract API key ───────────────────────────────────────
		if credentials is None:
			raise HTTPException(
				status_code=401,
				detail=self._error('UNAUTHORIZED', 'API key requerida. Usar header Authorization: Bearer <key>'),
			)

		# ── Resolve key ───────────────────────────────────────────
		result = resolve_api_key(credentials.credentials)
		if result is None:
			raise HTTPException(
				status_code=401,
				detail=self._error('UNAUTHORIZED', 'API key inválida o inactiva'),
			)

		developer, app, api_key, plan = result

		# ── Check key active ──────────────────────────────────────
		if not api_key.is_active:
			raise HTTPException(
				status_code=403,
				detail=self._error('API_KEY_INACTIVE', 'La API key está desactivada'),
			)

		# ── Check key has the required scope ──────────────────────
		if self.scope not in api_key.scopes:
			raise HTTPException(
				status_code=403,
				detail=self._error(
					'INSUFFICIENT_SCOPE',
					f'Se requiere scope: {self.scope.value}',
				),
			)

		# ── Populate request state ────────────────────────────────
		request.state.developer = developer
		request.state.app = app
		request.state.api_key = api_key
		request.state.plan = plan

	@staticmethod
	def _error(code: str, message: str) -> dict:
		"""Build a serializable error dict matching UnifiedResponse style."""
		return UnifiedResponse(
			status='error',
			error=ApiError(code=code, cause=message),
		).model_dump()
