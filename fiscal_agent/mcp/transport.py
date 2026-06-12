"""Transport dispatcher for the MCP server.

Reads MCP_TRANSPORT env var:
  - stdio (default): runs via stdin/stdout — no auth, local only.
  - http: wraps mcp.sse_app() in Starlette with auth middleware (Fase 2).

Auth strategy (HTTP mode):
  - GET /sse:          validate API key exists (any scope), reject if missing/invalid.
  - POST /messages/:   parse JSON-RPC body, for ``tools/call`` extract tool name
                       from ``params.name``, validate required scope.
  - Other paths:       validate API key exists (no scope check).
"""

from __future__ import annotations

import json
import logging
import os

logger = logging.getLogger(__name__)

# ── Scope map: tool name → required scope (for HTTP mode) ────────────────

# Tools not listed here require API key but no specific scope check.
SCOPE_MAP: dict[str, str] = {
	'get_calendar': 'calendar:read',
	'match_rentas_cordoba': 'calendar:read',
	'get_taxpayer': 'taxpayer:read',
	'extract_deuda': 'taxpayer:read',
	'extract_facilidades': 'taxpayer:read',
	'extract_registro': 'taxpayer:read',
	'get_report_pdf': 'report:read',
	'run_pipeline': 'report:write',
	# health is public — no key required
}


def run_mcp() -> None:
	"""Run the MCP server based on MCP_TRANSPORT env var.

	Usage:
	    python -m fiscal_agent mcp           → STDIO (default)
	    MCP_TRANSPORT=http python -m fiscal_agent mcp  → HTTP/SSE
	"""
	transport = os.environ.get('MCP_TRANSPORT', 'stdio').strip().lower()

	if transport == 'http':
		_run_http()
	else:
		_run_stdio()


def _run_stdio() -> None:
	"""Run MCP server via STDIO transport — local only, no auth."""
	from fiscal_agent.mcp.server import mcp

	logger.info('[mcp] Starting STDIO transport ...')
	mcp.run(transport='stdio')


def _run_http() -> None:
	"""Run MCP server via HTTP/SSE transport with auth middleware (Fase 2).

	Requires Fase 2 seeded store (API keys, plans). Health check is public.
	"""
	from fiscal_agent.mcp.server import mcp
	from fiscal_agent.models import ApiError, UnifiedResponse

	# Lazy imports for HTTP-only dependencies
	from starlette.applications import Starlette
	from starlette.middleware import Middleware
	from starlette.middleware.base import BaseHTTPMiddleware
	from starlette.requests import Request
	from starlette.responses import JSONResponse, Response

	# ── Auth middleware ──────────────────────────────────────────

	class MCPAuthMiddleware(BaseHTTPMiddleware):
		"""Validate Bearer token at connection time and scope per tool call."""

		async def dispatch(self, request: Request, call_next) -> Response:
			# Step 1: extract + resolve API key
			api_key_data = await _resolve_api_key_from_request(request)

			# None = no Fase 2 store available (dev mode) → allow all
			if api_key_data is None and _store_unavailable():
				return await call_next(request)

			# None = auth failed
			if api_key_data is None:
				return _auth_error(401, 'UNAUTHORIZED', 'API key inválida o inactiva')

			_dev, _app, api_key_obj, plan = api_key_data

			# Step 2: for POST /messages/, extract tool name from JSON-RPC body
			if request.method == 'POST' and request.url.path.rstrip('/').endswith('/messages'):
				scope_error = await _check_message_scope(request, api_key_obj)
				if scope_error:
					return scope_error

			# Step 3: rate limit (only for tool calls, not SSE handshake)
			if plan and request.method == 'POST':
				from fiscal_agent.api.rate_limiter import check_rate_limit

				rl_ok, _headers = check_rate_limit(api_key_obj.id, plan)
				if not rl_ok:
					return JSONResponse(
						status_code=429,
						content=UnifiedResponse(
							status='error',
							error=ApiError(code='RATE_LIMIT_EXCEEDED', cause='Límite de tasa excedido'),
						).model_dump(),
					)

			return await call_next(request)

	# ── Build Starlette app ───────────────────────────────────────

	sse_app = mcp.sse_app()

	app = Starlette(
		middleware=[
			Middleware(MCPAuthMiddleware),
		],
		routes=sse_app.routes,
	)

	logger.info('[mcp] Starting HTTP/SSE transport on port 8000 ...')
	import uvicorn

	uvicorn.run(app, host='0.0.0.0', port=int(os.environ.get('MCP_PORT', '8000')))


# ── Helpers ──────────────────────────────────────────────────────────────


async def _resolve_api_key_from_request(request: Request):
	"""Extract Bearer token, resolve it via Fase 2 store.

	Returns (Developer, App, ApiKey, Plan) tuple, or None if invalid/missing.

	Note: If the Fase 2 store modules can't be imported, *this function itself*
	does not fail — it returns None, and the middleware checks
	_store_unavailable() to decide whether to allow pass-through.
	"""
	auth = request.headers.get('Authorization', '')
	if not auth.startswith('Bearer '):
		return None

	api_key = auth.removeprefix('Bearer ').strip()
	if not api_key:
		return None

	try:
		from fiscal_agent.api.store import resolve_api_key

		resolved = resolve_api_key(api_key)
		if resolved is None:
			return None
		return resolved
	except ImportError:
		return None


_store_unavailable_cache: bool | None = None


def _store_unavailable() -> bool:
	"""Check if Fase 2 store is unavailable (dev mode). Cached after first call."""
	global _store_unavailable_cache
	if _store_unavailable_cache is not None:
		return _store_unavailable_cache
	try:
		from fiscal_agent.api.store import resolve_api_key  # noqa: F401

		_store_unavailable_cache = False
	except ImportError:
		_store_unavailable_cache = True
	return _store_unavailable_cache


async def _check_message_scope(request: Request, api_key_obj) -> JSONResponse | None:
	"""Parse JSON-RPC body and validate scope for tools/call messages.

	Returns a JSONResponse (error) if scope check fails, or None to allow.
	"""
	try:
		body = await request.body()
		if not body:
			return None

		msg = json.loads(body)

		# Only check scope for tools/call messages
		if not isinstance(msg, dict):
			return None
		method = msg.get('method', '')
		if method != 'tools/call':
			return None

		# Extract tool name from params
		params = msg.get('params', {})
		if not isinstance(params, dict):
			return None
		tool_name = params.get('name', '')

		if not tool_name:
			return None

		# Look up required scope
		scope_required = SCOPE_MAP.get(tool_name)
		if scope_required is None:
			# Tool not in map — allow if key is valid (no specific scope)
			return None

		# Check scope
		scope_enum = _scope_str_to_enum(scope_required)
		if scope_enum and scope_enum not in api_key_obj.scopes:
			return _auth_error(
				403,
				'INSUFFICIENT_SCOPE',
				f'Se requiere scope "{scope_required}" para la tool "{tool_name}"',
			)

	except (json.JSONDecodeError, UnicodeDecodeError):
		# Malformed body — let MCP handler deal with it
		pass

	return None


def _auth_error(status: int, code: str, cause: str) -> JSONResponse:
	"""Return a structured auth error as UnifiedResponse JSON."""
	from fiscal_agent.models import ApiError, UnifiedResponse

	return JSONResponse(
		status_code=status,
		content=UnifiedResponse(
			status='error',
			error=ApiError(code=code, cause=cause),
		).model_dump(),
		headers={'Content-Type': 'application/json'},
	)


def _scope_str_to_enum(scope_str: str):
	"""Convert a scope string like 'calendar:read' to Scope enum value."""
	from fiscal_agent.models import Scope

	for s in Scope:
		if s.value == scope_str:
			return s
	return None
