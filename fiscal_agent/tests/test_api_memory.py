"""Tests for memory REST endpoints — GET /v1/memory/{cuit}, POST /v1/memory/observe.

Uses FastAPI TestClient with a mocked Redis store that accepts any ``fa_`` key
with ``admin:read`` and ``admin:write`` scopes.
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest
from fastapi import FastAPI, Response
from fastapi.testclient import TestClient

from fiscal_agent.memory.client import FiscalMemoryClient
from fiscal_agent.models import ApiKey, App, Developer, Plan, Scope


# ── Valid API key that our mock store will accept ────────────────────────────

_VALID_KEY = 'fa_test_admin_key_12345'


def _make_mock_store_result() -> tuple:
	"""Return a tuple matching ``RedisStore.resolve_api_key`` return type."""
	dev = Developer(
		id='dev-1',
		name='Test Dev',
		email='dev@test.com',
		auth0_id='',
		created_at=__import__('datetime').datetime.now(),
		is_active=True,
	)
	app = App(
		id='app-1',
		developer_id='dev-1',
		name='Test App',
		environment='sandbox',
		status='active',
	)
	api_key = ApiKey(
		id='key-1',
		app_id='app-1',
		key_preview=_VALID_KEY[-4:],
		is_active=True,
		scopes=[Scope.ADMIN_READ, Scope.ADMIN_WRITE],
		created_at=__import__('datetime').datetime.now(),
	)
	plan = Plan(
		id='plan-1',
		name='Test Plan',
		scopes=[Scope.ADMIN_READ, Scope.ADMIN_WRITE],
		rate_limit_rpm=1000,
		rate_limit_rpd=10000,
	)
	return (dev, app, api_key, plan)


# ── Fixtures ─────────────────────────────────────────────────────────────────


@pytest.fixture
def mock_memory() -> MagicMock:
	"""Return a mocked FiscalMemoryClient."""
	mock = MagicMock(spec=FiscalMemoryClient)
	mock.get_pipeline_history.return_value = [
		{'id': 1, 'type': 'padron', 'title': 'Padrón A5'},
		{'id': 2, 'type': 'deuda', 'title': 'Extracción deuda'},
	]
	mock.get_extraction_history.return_value = [
		{'id': 1, 'type': 'padron', 'title': 'Padrón A5'},
	]
	mock._cuit_session_id.return_value = 'cuit-20324837796'
	mock._engram_post.return_value = {'id': 42}
	return mock


@pytest.fixture
def app(mock_memory: MagicMock) -> FastAPI:
	"""Build a FastAPI app with mocked store that accepts our API key.

	Patches ``get_memory`` to return the mock and ``store.resolve_api_key``
	to return a valid developer/app/key/plan tuple.
	"""
	app = FastAPI()

	# Set up the mock store on app.state BEFORE including routers
	mock_store = MagicMock()
	mock_store.resolve_api_key.return_value = _make_mock_store_result()
	app.state.store = mock_store
	app.state.redis = MagicMock()

	# Also need to mock the rate limit check
	mock_rate = MagicMock()
	from fiscal_agent.api.rate_limiter import check_rate_limit

	app.dependency_overrides[check_rate_limit] = lambda api_key_id, plan: {
		'allowed': True,
		'retry_after': 0,
		'remaining': 999,
	}

	from fiscal_agent.api.routes.memory import router

	app.include_router(router)

	# Override get_memory (this one works because get_memory is a module-level function reference)
	from fiscal_agent.api.deps import get_memory

	app.dependency_overrides[get_memory] = lambda: mock_memory

	return app


@pytest.fixture
def client(app: FastAPI) -> TestClient:
	"""Return a TestClient configured to send a valid API key."""
	return TestClient(app)


@pytest.fixture
def auth_header() -> dict[str, str]:
	"""Return a valid Authorization header."""
	return {'Authorization': f'Bearer {_VALID_KEY}'}


# ── Mock get_memory BEFORE the app constructs (module-level patch) ──────────


@pytest.fixture(autouse=True)
def _patch_get_memory(mock_memory: MagicMock):
	"""Patch get_memory at the route module level so imports resolve to mock."""
	with patch('fiscal_agent.api.routes.memory.get_memory', return_value=mock_memory):
		yield


# ── Happy path GET ───────────────────────────────────────────────────────────


class TestGetMemoryHistory:
	"""Task 4.4: GET /v1/memory/{cuit} endpoints."""

	def test_get_memory_history(self, client: TestClient, auth_header: dict) -> None:
		"""Happy path: returns observations list."""
		resp = client.get('/v1/memory/20324837796', headers=auth_header)

		assert resp.status_code == 200
		data = resp.json()
		assert data['status'] == 'success'
		assert len(data['result']) == 2
		assert data['result'][0]['type'] == 'padron'

	def test_get_memory_by_type(self, client: TestClient, auth_header: dict) -> None:
		"""Filtering by type returns only matching observations."""
		resp = client.get('/v1/memory/20324837796/padron', headers=auth_header)

		assert resp.status_code == 200
		data = resp.json()
		assert data['status'] == 'success'
		assert len(data['result']) == 1
		assert data['result'][0]['type'] == 'padron'

	def test_get_memory_history_empty(self, client: TestClient, auth_header: dict, mock_memory: MagicMock) -> None:
		"""CUIT sin observaciones devuelve lista vacía."""
		mock_memory.get_pipeline_history.return_value = []

		resp = client.get('/v1/memory/20324837796', headers=auth_header)

		assert resp.status_code == 200
		data = resp.json()
		assert data['status'] == 'success'
		assert data['result'] == []

	def test_get_memory_by_type_empty(self, client: TestClient, auth_header: dict, mock_memory: MagicMock) -> None:
		"""Filtrar por tipo sin resultados devuelve lista vacía."""
		mock_memory.get_extraction_history.return_value = []

		resp = client.get('/v1/memory/20324837796/deuda', headers=auth_header)

		assert resp.status_code == 200
		data = resp.json()
		assert data['status'] == 'success'
		assert data['result'] == []

	def test_get_memory_history_invalid_cuit(self, client: TestClient, auth_header: dict) -> None:
		"""CUIT inválido devuelve INVALID_CUIT."""
		resp = client.get('/v1/memory/12345', headers=auth_header)

		assert resp.status_code == 200  # UnifiedResponse siempre 200
		data = resp.json()
		assert data['status'] == 'error'
		assert data['error']['code'] == 'INVALID_CUIT'


# ── Happy path POST ──────────────────────────────────────────────────────────


class TestPostObserve:
	"""Task 4.4: POST /v1/memory/observe endpoint."""

	def test_observe_valid(self, client: TestClient, auth_header: dict) -> None:
		"""Happy path: returns 201 with success."""
		resp = client.post(
			'/v1/memory/observe',
			json={
				'cuit': '20324837796',
				'title': 'Observación test',
				'type': 'test',
				'content': '**Status**: ok',
			},
			headers=auth_header,
		)

		assert resp.status_code == 201
		data = resp.json()
		assert data['status'] == 'success'
		assert data['result']['cuit'] == '20324837796'

	def test_observe_engram_unavailable(self, client: TestClient, auth_header: dict, mock_memory: MagicMock) -> None:
		"""Engram no disponible devuelve MEMORY_UNAVAILABLE."""
		mock_memory.is_available.return_value = False

		resp = client.post(
			'/v1/memory/observe',
			json={
				'cuit': '20324837796',
				'title': 'Test',
				'type': 'test',
				'content': 'sin engram',
			},
			headers=auth_header,
		)

		assert resp.status_code == 200
		data = resp.json()
		assert data['status'] == 'error'
		assert data['error']['code'] == 'MEMORY_UNAVAILABLE'


# ── Validation errors ────────────────────────────────────────────────────────


class TestValidationErrors:
	"""Task 4.4: Validation errors return proper error responses."""

	def test_invalid_cuit_length(self, client: TestClient, auth_header: dict) -> None:
		"""CUIT must be 11 chars — 422 returned."""
		resp = client.post(
			'/v1/memory/observe',
			json={
				'cuit': '12345',
				'title': 'Test',
				'content': 'test',
			},
			headers=auth_header,
		)

		assert resp.status_code == 422

	def test_content_too_large(self, client: TestClient, auth_header: dict) -> None:
		"""Content > 10 KB returns 422."""
		resp = client.post(
			'/v1/memory/observe',
			json={
				'cuit': '20324837796',
				'title': 'Test',
				'content': 'x' * 10_241,
			},
			headers=auth_header,
		)

		assert resp.status_code == 422


# ── Auth fallback scope ─────────────────────────────────────────────────────


class TestAuthScope:
	"""Task 4.4: Auth enforcement."""

	def test_get_memory_history_requires_auth(self) -> None:
		"""Without auth headers, returns 401."""
		app = FastAPI()
		from fiscal_agent.api.routes.memory import router

		app.include_router(router)
		no_auth_client = TestClient(app)

		resp = no_auth_client.get('/v1/memory/20324837796')
		assert resp.status_code == 401

	def test_post_observe_requires_auth(self) -> None:
		"""Without auth headers, returns 401."""
		app = FastAPI()
		from fiscal_agent.api.routes.memory import router

		app.include_router(router)
		no_auth_client = TestClient(app)

		resp = no_auth_client.post(
			'/v1/memory/observe',
			json={'cuit': '20324837796', 'title': 'Test', 'content': 'test'},
		)
		assert resp.status_code == 401
