"""API Key + Auth0 JWT authentication and scope enforcement for FastAPI.

Dual-mode authentication:
- ``Bearer fa_*`` → API key resolution via Redis
- ``Bearer <JWT>`` → Auth0 RS256 JWT verification via JWKS

Usage::

    from fiscal_agent.api.auth import ScopeRequired, ScopeRequiredJWT
    from fiscal_agent.models import Scope


    @router.get('/v1/taxpayer/{cuit}')
    async def get_taxpayer(
        cuit: str,
        _: None = Depends(ScopeRequired(Scope.TAXPAYER_READ)),
    ): ...


    @router.post('/v1/admin/register')
    async def register(
        body: RegisterRequest,
        _: None = Depends(ScopeRequiredJWT(Scope.ADMIN_WRITE)),
    ): ...
"""

from __future__ import annotations

import base64
import json
import logging
import os
import time
from typing import Any, Optional

import httpx
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from fiscal_agent.api.rate_limiter import check_rate_limit
from fiscal_agent.api.store import RedisStore
from fiscal_agent.models import ApiError, Scope, UnifiedResponse

logger = logging.getLogger(__name__)

security = HTTPBearer(auto_error=False)

# ── JWKS cache ─────────────────────────────────────────────────────

_jwks_cache: dict[str, Any] | None = None
_jwks_fetched_at: float = 0.0
_JWKS_CACHE_TTL = 600  # 10 minutes

# ── Management API token cache ─────────────────────────────────────

_mgmt_token: str | None = None
_mgmt_token_expires_at: float = 0.0

# ── Base64 helpers ─────────────────────────────────────────────────


def _b64decode(data: str) -> bytes:
	"""Decode base64url with padding restoration."""
	padding_len = 4 - len(data) % 4
	if padding_len != 4:
		data += '=' * padding_len
	return base64.urlsafe_b64decode(data)


# ── JWK → RSA helpers ──────────────────────────────────────────────


def _jwk_to_rsa_public_key(jwk: dict) -> rsa.RSAPublicKey:
	"""Convert a JWK dict (with ``n`` and ``e``) to an RSA public key."""
	n_bytes = _b64decode(jwk['n'])
	e_bytes = _b64decode(jwk['e'])
	n = int.from_bytes(n_bytes, 'big')
	e = int.from_bytes(e_bytes, 'big')
	return rsa.RSAPublicNumbers(e, n).public_key()


# ── JWKS fetching ──────────────────────────────────────────────────


async def _fetch_jwks() -> dict[str, Any]:
	"""Fetch and cache JWKS from Auth0's well-known endpoint.

	Returns the ``keys`` array as a ``{kid: key}`` lookup dict.
	"""
	global _jwks_cache, _jwks_fetched_at

	domain = os.getenv('AUTH0_DOMAIN', '')
	if not domain:
		raise ValueError('AUTH0_DOMAIN no está configurado')

	url = f'https://{domain}/.well-known/jwks.json'
	async with httpx.AsyncClient() as client:
		resp = await client.get(url, timeout=10)
		resp.raise_for_status()
		data = resp.json()

	keys = data.get('keys', [])
	_jwks_cache = {key['kid']: key for key in keys}
	_jwks_fetched_at = time.time()
	logger.info('JWKS actualizado — %d keys cacheadas', len(_jwks_cache))
	return _jwks_cache


async def _get_jwks_key(kid: str) -> dict | None:
	"""Get a JWK by its ``kid``, fetching/refreshing the cache as needed."""
	global _jwks_cache, _jwks_fetched_at

	now = time.time()
	if _jwks_cache is None or (now - _jwks_fetched_at) > _JWKS_CACHE_TTL:
		await _fetch_jwks()

	key = _jwks_cache.get(kid) if _jwks_cache else None
	if key is None:
		# Cache miss — force re-fetch (key rotation)
		await _fetch_jwks()
		key = _jwks_cache.get(kid) if _jwks_cache else None

	return key


# ── JWT verification ───────────────────────────────────────────────


async def verify_auth0_jwt(token: str) -> dict | None:
	"""Verify an Auth0-issued RS256 JWT.

	Validates signature via JWKS, and checks ``iss``, ``aud``, and ``exp``
	claims. Returns the decoded claims dict on success, or ``None`` on
	any verification failure.
	"""
	try:
		# Decode header (without verification)
		parts = token.split('.')
		if len(parts) != 3:
			logger.warning('Token JWT no tiene 3 partes')
			return None

		header_b64 = parts[0]
		header_data = json.loads(_b64decode(header_b64))
		kid = header_data.get('kid')
		alg = header_data.get('alg')

		if alg != 'RS256':
			logger.warning('Algoritmo JWT no soportado: %s', alg)
			return None

		if not kid:
			logger.warning('JWT sin kid')
			return None

		# Get JWK
		jwk = await _get_jwks_key(kid)
		if jwk is None:
			logger.warning('JWK no encontrado para kid: %s', kid)
			return None

		# Build RSA public key
		public_key = _jwk_to_rsa_public_key(jwk)

		# Verify signature
		signing_input = f'{parts[0]}.{parts[1]}'.encode()
		sig_bytes = _b64decode(parts[2])

		try:
			public_key.verify(sig_bytes, signing_input, padding.PKCS1v15(), hashes.SHA256())
		except Exception:
			logger.warning('Firma JWT inválida')
			return None

		# Decode payload
		payload = json.loads(_b64decode(parts[1]))

		# Validate claims
		domain = os.getenv('AUTH0_DOMAIN', '')
		audience = os.getenv('AUTH0_AUDIENCE', '')

		expected_iss = f'https://{domain}/' if domain else ''
		if expected_iss and payload.get('iss') != expected_iss:
			logger.warning('JWT iss mismatch: esperado=%s, recibido=%s', expected_iss, payload.get('iss'))
			return None

		if audience and payload.get('aud') != audience:
			logger.warning('JWT aud mismatch: esperado=%s, recibido=%s', audience, payload.get('aud'))
			return None

		now_ts = time.time()
		exp = payload.get('exp', 0)
		if now_ts > exp + 30:  # 30-second leeway
			logger.warning('JWT expirado: exp=%d, now=%d', exp, now_ts)
			return None

		return payload

	except Exception as exc:
		logger.warning('Error verificando JWT: %s', exc)
		return None


# ── Auth0 User Info ────────────────────────────────────────────────


async def get_auth0_user_info(access_token: str) -> dict | None:
	"""Fetch user info from Auth0's /userinfo endpoint.

	Returns the JSON response (includes ``sub``, ``name``, ``email``,
	and optionally ``app_metadata``) or ``None`` on failure.
	"""
	try:
		domain = os.getenv('AUTH0_DOMAIN', '')
		if not domain:
			return None

		url = f'https://{domain}/userinfo'
		async with httpx.AsyncClient() as client:
			resp = await client.get(
				url,
				headers={'Authorization': f'Bearer {access_token}'},
				timeout=10,
			)
			if resp.status_code != 200:
				logger.warning('/userinfo responded %d', resp.status_code)
				return None
			return resp.json()
	except Exception as exc:
		logger.warning('Error en /userinfo: %s', exc)
		return None


# ── Auth0 Management API ───────────────────────────────────────────


class Auth0ManagementClient:
	"""Client for Auth0 Management API operations.

	Handles token acquisition via client_credentials grant and provides
	methods to look up user info by Auth0 user ID.
	"""

	def __init__(self) -> None:
		self._domain = os.getenv('AUTH0_DOMAIN', '')
		self._client_id = os.getenv('AUTH0_MGMT_CLIENT_ID', '')
		self._client_secret = os.getenv('AUTH0_MGMT_CLIENT_SECRET', '')
		self._configured = bool(self._domain and self._client_id and self._client_secret)

	async def _get_token(self) -> str | None:
		"""Get or refresh a Management API access token."""
		global _mgmt_token, _mgmt_token_expires_at

		if not self._configured:
			return None

		now = time.time()
		if _mgmt_token and now < _mgmt_token_expires_at - 60:
			return _mgmt_token

		try:
			url = f'https://{self._domain}/oauth/token'
			payload = {
				'client_id': self._client_id,
				'client_secret': self._client_secret,
				'audience': f'https://{self._domain}/api/v2/',
				'grant_type': 'client_credentials',
			}
			async with httpx.AsyncClient() as client:
				resp = await client.post(url, json=payload, timeout=10)
				resp.raise_for_status()
				data = resp.json()

			_mgmt_token = data['access_token']
			_mgmt_token_expires_at = now + data.get('expires_in', 86400)
			return _mgmt_token
		except Exception as exc:
			logger.warning('Error obteniendo token Management API: %s', exc)
			return None

	async def get_user(self, auth0_id: str) -> dict | None:
		"""Look up a user by Auth0 user ID via the Management API.

		Returns user info including ``app_metadata``, or ``None`` if
		the user is not found or the API is not configured.
		"""
		if not self._configured:
			return None

		token = await self._get_token()
		if token is None:
			return None

		try:
			url = f'https://{self._domain}/api/v2/users/{auth0_id}'
			async with httpx.AsyncClient() as client:
				resp = await client.get(
					url,
					headers={'Authorization': f'Bearer {token}'},
					timeout=10,
				)
				if resp.status_code == 404:
					return None
				resp.raise_for_status()
				return resp.json()
		except Exception as exc:
			logger.warning('Error en Management API get_user: %s', exc)
			return None


# ── Error helpers ──────────────────────────────────────────────────


def _unauthorized(code: str = 'UNAUTHORIZED', message: str = '') -> HTTPException:
	return HTTPException(
		status_code=401,
		detail=UnifiedResponse(
			status='error',
			error=ApiError(code=code, cause=message or 'Autenticación requerida'),
		).model_dump(),
	)


def _forbidden(code: str, message: str) -> HTTPException:
	return HTTPException(
		status_code=403,
		detail=UnifiedResponse(
			status='error',
			error=ApiError(code=code, cause=message),
		).model_dump(),
	)


def _too_many_requests(retry_after: int) -> HTTPException:
	return HTTPException(
		status_code=429,
		detail=UnifiedResponse(
			status='error',
			error=ApiError(
				code='RATE_LIMIT_EXCEEDED',
				cause=f'Límite de tasa excedido. Esperar {retry_after}s.',
			),
		).model_dump(),
	)


# ── ScopeRequired — Dual-mode dependency ─────────────────────────


class ScopeRequired:
	"""FastAPI dependency that enforces API key OR Auth0 JWT auth + scope check.

	Args:
		scope: The required scope/permission.
		require_jwt: If ``True``, only Auth0 JWT is accepted (API keys rejected).
			Admin endpoints use this.

	On success (API key path), populates ``request.state`` with:
	- ``developer``: Developer
	- ``app``: App
	- ``api_key``: ApiKey
	- ``plan``: Plan

	On success (JWT path), populates ``request.state`` with:
	- ``developer``: Developer (looked up by auth0_id)
	- ``auth0_claims``: dict (full JWT claims)
	"""

	def __init__(self, scope: Scope, require_jwt: bool = False):
		self.scope = scope
		self.require_jwt = require_jwt

	async def __call__(
		self,
		request: Request,
		credentials: HTTPAuthorizationCredentials | None = Depends(security),
	):
		if credentials is None:
			raise _unauthorized('UNAUTHORIZED', 'API key o JWT requerido')

		token = credentials.credentials

		if token.startswith('fa_'):
			return await self._api_key_path(request, token)
		else:
			return await self._jwt_path(request, token)

	async def _api_key_path(self, request: Request, token: str) -> None:
		"""Resolve API key via Redis, check scope, enforce rate limits."""
		if self.require_jwt:
			raise _unauthorized(
				'AUTH0_JWT_REQUIRED',
				'Solo JWT de Auth0 aceptado para este endpoint',
			)

		store: RedisStore = request.app.state.store
		result = await store.resolve_api_key(token)
		if result is None:
			raise _unauthorized('UNAUTHORIZED', 'API key inválida o inactiva')

		developer, app, api_key, plan = result

		if not api_key.is_active:
			raise _forbidden('API_KEY_INACTIVE', 'La API key está desactivada')

		if self.scope not in api_key.scopes:
			raise _forbidden(
				'INSUFFICIENT_SCOPE',
				f'Se requiere scope: {self.scope.value}',
			)

		# Populate request state
		request.state.developer = developer
		request.state.app = app
		request.state.api_key = api_key
		request.state.plan = plan

		# Enforce rate limits
		rl_result = await check_rate_limit(request.app.state.redis, api_key.id, plan)
		if not rl_result['allowed']:
			raise _too_many_requests(rl_result['retry_after'])

	async def _jwt_path(self, request: Request, token: str) -> None:
		"""Verify Auth0 JWT, check waitlist, look up developer, check permissions."""
		domain = os.getenv('AUTH0_DOMAIN')
		audience = os.getenv('AUTH0_AUDIENCE')
		if not domain or not audience:
			raise _unauthorized(
				'AUTH0_NOT_CONFIGURED',
				'Autenticación Auth0 no configurada',
			)

		# Verify JWT
		claims = await verify_auth0_jwt(token)
		if claims is None:
			raise _unauthorized('INVALID_TOKEN', 'Token JWT inválido')

		# Get user info and check app_metadata.status
		user_info = await get_auth0_user_info(token)
		app_metadata = user_info.get('app_metadata', {}) if user_info else {}
		status = app_metadata.get('status', '')

		# Fallback: try Management API if /userinfo didn't return app_metadata
		if not status:
			mgmt = Auth0ManagementClient()
			sub = claims.get('sub', '')
			mgmt_user = await mgmt.get_user(sub)
			if mgmt_user:
				app_metadata = mgmt_user.get('app_metadata', {}) or {}
				status = app_metadata.get('status', '')

		if status in ('waitlist', 'suspended'):
			raise _forbidden(
				'WAITLIST_NOT_APPROVED',
				'Usuario no aprobado — estado: ' + status,
			)

		# Look up developer by auth0_id
		sub = claims.get('sub', '')
		store: RedisStore = request.app.state.store
		developer = await store.get_developer_by_auth0_id(sub)
		if developer is None:
			raise _forbidden(
				'DEVELOPER_NOT_FOUND',
				'Desarrollador no encontrado. Registrarse primero.',
			)

		# Check permissions claim
		permissions = claims.get('permissions', [])
		if self.scope.value not in permissions:
			raise _forbidden(
				'INSUFFICIENT_SCOPE',
				f'Se requiere permiso: {self.scope.value}',
			)

		# Populate request state (only developer for JWT path)
		request.state.developer = developer
		request.state.auth0_claims = claims


# ── ScopeRequiredJWT — Register endpoint helper ───────────────────


class ScopeRequiredJWT:
	"""FastAPI dependency for JWT-only endpoints where the developer
	may not exist yet (e.g., ``POST /v1/admin/register``).

	Verifies JWT, checks waitlist status, checks permissions, and sets
	``request.state.auth0_claims`` (with ``sub``) — but does NOT look up
	the developer in Redis.

	Args:
		scope: The required scope/permission.
	"""

	def __init__(self, scope: Scope):
		self.scope = scope

	async def __call__(
		self,
		request: Request,
		credentials: HTTPAuthorizationCredentials | None = Depends(security),
	):
		if credentials is None:
			raise _unauthorized('UNAUTHORIZED', 'JWT de Auth0 requerido')

		token = credentials.credentials

		if token.startswith('fa_'):
			raise _unauthorized(
				'AUTH0_JWT_REQUIRED',
				'Solo JWT de Auth0 aceptado para este endpoint',
			)

		domain = os.getenv('AUTH0_DOMAIN')
		audience = os.getenv('AUTH0_AUDIENCE')
		if not domain or not audience:
			raise _unauthorized(
				'AUTH0_NOT_CONFIGURED',
				'Autenticación Auth0 no configurada',
			)

		# Verify JWT
		claims = await verify_auth0_jwt(token)
		if claims is None:
			raise _unauthorized('INVALID_TOKEN', 'Token JWT inválido')

		# Get user info and check app_metadata.status
		user_info = await get_auth0_user_info(token)
		app_metadata = user_info.get('app_metadata', {}) if user_info else {}
		status = app_metadata.get('status', '')

		# Fallback: Management API
		if not status:
			mgmt = Auth0ManagementClient()
			sub = claims.get('sub', '')
			mgmt_user = await mgmt.get_user(sub)
			if mgmt_user:
				app_metadata = mgmt_user.get('app_metadata', {}) or {}
				status = app_metadata.get('status', '')

		if status in ('waitlist', 'suspended'):
			raise _forbidden(
				'WAITLIST_NOT_APPROVED',
				'Usuario no aprobado — estado: ' + status,
			)

		# Check permissions
		permissions = claims.get('permissions', [])
		if self.scope.value not in permissions:
			raise _forbidden(
				'INSUFFICIENT_SCOPE',
				f'Se requiere permiso: {self.scope.value}',
			)

		# Store claims (with ``sub``) without looking up developer
		request.state.auth0_claims = claims
