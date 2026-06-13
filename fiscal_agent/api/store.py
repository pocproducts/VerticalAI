"""Redis-backed data store for tenant management.

Replaces the in-memory store with Redis for data persistence
across server restarts. All entity data is stored via Redis Hashes
and round-trips through ``model_dump(mode='json')`` /
``model_validate()``.
"""

from __future__ import annotations

import hashlib
import json
import logging
import secrets
import uuid
from datetime import datetime, timezone

from redis.asyncio import Redis

from fiscal_agent.models import ApiKey, App, Developer, Plan, Scope

logger = logging.getLogger(__name__)

# ── Redis key schema prefixes ───────────────────────────────────────

_KEY_DEVELOPER = 'tenant:developer:{}'  # Hash -> Developer fields
_KEY_APP = 'tenant:app:{}'  # Hash -> App fields
_KEY_APIKEY = 'tenant:apikey:{}'  # Hash -> ApiKey fields
_KEY_PLAN = 'tenant:plan:{}'  # Hash -> Plan fields
_KEY_KEYHASH = 'tenant:keyhash:{}'  # String -> api_key_id
_KEY_DEV_BY_EMAIL = 'tenant:developer:by_email:{}'  # String -> developer_id
_KEY_DEV_BY_AUTH0 = 'tenant:developer:by_auth0:{}'  # String -> developer_id
_KEY_DEV_APPS = 'tenant:developer:apps:{}'  # Set    -> app_ids
_KEY_APP_KEYS = 'tenant:app:keys:{}'  # Set    -> api_key_ids


class StoreError(Exception):
	"""Base exception for store operations."""


class ConflictError(StoreError):
	"""Raised when a resource conflict occurs (e.g., duplicate email)."""

	def __init__(self, code: str, message: str) -> None:
		self.code = code
		super().__init__(message)


class NotFoundError(StoreError):
	"""Raised when a resource is not found."""

	def __init__(self, code: str, message: str) -> None:
		self.code = code
		super().__init__(message)


class RedisStore:
	"""Redis-backed store for tenant entities.

	Wraps all Redis operations with typed methods that accept and return
	Pydantic models. Uses ``model_dump(mode='json')`` for serialization
	and ``model_validate()`` for deserialization.
	"""

	def __init__(self, redis_client: Redis) -> None:
		self.redis = redis_client

	# ── Helpers ────────────────────────────────────────────────────

	@staticmethod
	def _generate_id() -> str:
		"""Generate a short unique ID (12 hex chars)."""
		return uuid.uuid4().hex[:12]

	@staticmethod
	def _hash_key(key: str) -> str:
		"""SHA-256 hash for API key lookup."""
		return hashlib.sha256(key.encode()).hexdigest()

	@staticmethod
	def _serialize_for_redis(data: dict) -> dict:
		"""Convert model_dump data to Redis-safe strings preserving types.

		Uses JSON serialization per field so that booleans, lists, None,
		and other non-string types round-trip correctly through Redis
		(which stores all hash values as strings).
		"""
		return {k: json.dumps(v, ensure_ascii=False) for k, v in data.items()}

	@staticmethod
	def _deserialize_from_redis(raw: dict) -> dict:
		"""Convert Redis hash string values back to proper Python types.

		Each value is parsed through JSON to restore booleans, lists,
		None, and enums that were serialized by ``_serialize_for_redis``.
		"""
		result = {}
		for k, v in raw.items():
			try:
				result[k] = json.loads(v)
			except (json.JSONDecodeError, TypeError):
				result[k] = v
		return result

	@staticmethod
	def _deserialize(model_class, data: dict):
		"""Deserialize a Redis hash dict back into a Pydantic model."""
		parsed = RedisStore._deserialize_from_redis(data)
		return model_class.model_validate(parsed)

	# ── Developer CRUD ─────────────────────────────────────────────

	async def register_developer(self, name: str, email: str, auth0_id: str = '') -> Developer:
		"""Register a new developer account.

		Raises ``ConflictError`` (409) if the email already exists.
		If ``auth0_id`` is non-empty, also indexes the developer by Auth0 ID.
		"""
		# Check email uniqueness
		existing = await self.redis.get(_KEY_DEV_BY_EMAIL.format(email))
		if existing:
			raise ConflictError(
				'EMAIL_ALREADY_EXISTS',
				f'El email {email} ya está registrado',
			)

		dev_id = self._generate_id()
		dev = Developer(
			id=dev_id,
			name=name,
			email=email,
			auth0_id=auth0_id,
			created_at=datetime.now(timezone.utc),
			is_active=True,
		)
		await self.redis.hset(
			_KEY_DEVELOPER.format(dev_id),
			mapping=self._serialize_for_redis(dev.model_dump(mode='json')),
		)
		await self.redis.set(_KEY_DEV_BY_EMAIL.format(email), dev_id)
		if auth0_id:
			await self.redis.set(_KEY_DEV_BY_AUTH0.format(auth0_id), dev_id)
		return dev

	async def get_developer_by_auth0_id(self, auth0_id: str) -> Developer | None:
		"""Look up a developer by Auth0 user ID (``sub`` claim)."""
		dev_id = await self.redis.get(_KEY_DEV_BY_AUTH0.format(auth0_id))
		if dev_id is None:
			return None
		data = await self.redis.hgetall(_KEY_DEVELOPER.format(dev_id))
		if not data:
			return None
		return self._deserialize(Developer, data)

	async def get_developer_by_email(self, email: str) -> Developer | None:
		"""Look up a developer by email."""
		dev_id = await self.redis.get(_KEY_DEV_BY_EMAIL.format(email))
		if dev_id is None:
			return None
		data = await self.redis.hgetall(_KEY_DEVELOPER.format(dev_id))
		if not data:
			return None
		return self._deserialize(Developer, data)

	# ── App CRUD ───────────────────────────────────────────────────

	async def create_app(self, developer_id: str, name: str, environment: str) -> App | None:
		"""Create a new app for a developer.

		Returns ``None`` if the developer doesn't exist.
		"""
		dev_exists = await self.redis.hexists(_KEY_DEVELOPER.format(developer_id), 'id')
		if not dev_exists:
			return None

		app_id = self._generate_id()
		app = App(
			id=app_id,
			developer_id=developer_id,
			name=name,
			environment=environment,
			status='active',
		)
		await self.redis.hset(
			_KEY_APP.format(app_id),
			mapping=self._serialize_for_redis(app.model_dump(mode='json')),
		)
		# Maintain developer -> apps index
		await self.redis.sadd(_KEY_DEV_APPS.format(developer_id), app_id)
		return app

	# ── API Key CRUD ───────────────────────────────────────────────

	async def create_api_key(self, app_id: str) -> dict | None:
		"""Generate a new API key for an app.

		Returns ``{'api_key': ApiKey, 'full_key': str}`` or ``None``
		if the app doesn't exist. The full key is only returned once.
		"""
		app_exists = await self.redis.hexists(_KEY_APP.format(app_id), 'id')
		if not app_exists:
			return None

		full_key = f'fa_{secrets.token_hex(16)}'
		api_key = ApiKey(
			id=self._generate_id(),
			app_id=app_id,
			key_preview=full_key[-4:],
			is_active=True,
			created_at=datetime.now(timezone.utc),
		)
		await self.redis.hset(
			_KEY_APIKEY.format(api_key.id),
			mapping=self._serialize_for_redis(api_key.model_dump(mode='json')),
		)
		await self.redis.set(_KEY_KEYHASH.format(self._hash_key(full_key)), api_key.id)
		# Maintain app -> keys index
		await self.redis.sadd(_KEY_APP_KEYS.format(app_id), api_key.id)
		return {'api_key': api_key, 'full_key': full_key}

	async def resolve_api_key(self, key: str) -> tuple[Developer, App, ApiKey, Plan] | None:
		"""Resolve a full API key to its Developer, App, ApiKey, and Plan.

		Returns ``None`` if the key is unknown, inactive, or any entity
		in the chain is inactive/missing.
		"""
		api_key_id = await self.redis.get(_KEY_KEYHASH.format(self._hash_key(key)))
		if api_key_id is None:
			return None

		api_key_data = await self.redis.hgetall(_KEY_APIKEY.format(api_key_id))
		if not api_key_data:
			return None
		api_key = self._deserialize(ApiKey, api_key_data)
		if not api_key.is_active:
			return None

		app_data = await self.redis.hgetall(_KEY_APP.format(api_key.app_id))
		if not app_data:
			return None
		app = self._deserialize(App, app_data)
		if app.status != 'active':
			return None

		dev_data = await self.redis.hgetall(_KEY_DEVELOPER.format(app.developer_id))
		if not dev_data:
			return None
		dev = self._deserialize(Developer, dev_data)
		if not dev.is_active:
			return None

		# Resolve plan — find first plan whose scopes cover this key's scopes
		plan = await self._resolve_plan(api_key.scopes)
		return (dev, app, api_key, plan)

	async def list_developer_keys(self, developer_id: str) -> list[ApiKey]:
		"""List all API keys across all apps owned by a developer."""
		dev_exists = await self.redis.hexists(_KEY_DEVELOPER.format(developer_id), 'id')
		if not dev_exists:
			return []

		# Get all app IDs for this developer
		app_ids = await self.redis.smembers(_KEY_DEV_APPS.format(developer_id))
		if not app_ids:
			return []

		# Collect all key IDs for those apps
		key_ids: list[str] = []
		for app_id in app_ids:
			app_key_ids = await self.redis.smembers(_KEY_APP_KEYS.format(app_id))
			key_ids.extend(app_key_ids)

		# Fetch and deserialize each key
		keys: list[ApiKey] = []
		for kid in key_ids:
			data = await self.redis.hgetall(_KEY_APIKEY.format(kid))
			if data:
				keys.append(self._deserialize(ApiKey, data))
		return keys

	# ── Plan helpers ───────────────────────────────────────────────

	async def _resolve_plan(self, scopes: list[Scope]) -> Plan | None:
		"""Find a plan whose scopes cover the given scopes."""
		cursor = 0
		plans: list[Plan] = []
		while True:
			cursor, keys = await self.redis.scan(cursor, match=_KEY_PLAN.format('*'), count=50)
			for key in keys:
				data = await self.redis.hgetall(key)
				if data:
					plans.append(self._deserialize(Plan, data))
			if cursor == 0:
				break

		if not plans:
			return None

		# Try exact match first: plan covers ALL key scopes
		plan_scope_sets = {p.id: set(p.scopes) for p in plans}
		key_scope_set = set(scopes)

		for plan in plans:
			if key_scope_set.issubset(plan_scope_sets[plan.id]):
				return plan

		# Fallback: any plan with at least one matching scope
		for plan in plans:
			if key_scope_set & plan_scope_sets[plan.id]:
				return plan

		# Absolute fallback: first plan
		return plans[0]

	# ── Seed ───────────────────────────────────────────────────────

	async def seed_defaults(self) -> None:
		"""Seed default plans and admin developer if Redis is empty.

		Checks if any ``tenant:*`` keys exist. If data is present,
		returns immediately (idempotent). Otherwise creates:
		- Free plan with basic scopes
		- Admin developer with a default app and API key
		"""
		# Check if any tenant data exists
		cursor = 0
		has_data = False
		while True:
			cursor, keys = await self.redis.scan(cursor, match='tenant:*', count=10)
			if keys:
				has_data = True
				break
			if cursor == 0:
				break

		if has_data:
			logger.info('Redis ya tiene datos — se omite seed')
			return

		logger.info('Redis vacío — sembrando datos por defecto')

		# ── Free plan ──────────────────────────────────────────────
		free_plan = Plan(
			id=self._generate_id(),
			name='Free',
			scopes=[
				Scope.CALENDAR_READ,
				Scope.TAXPAYER_READ,
				Scope.REPORT_READ,
			],
			rate_limit_rpm=10,
			rate_limit_rpd=100,
		)
		await self.redis.hset(
			_KEY_PLAN.format(free_plan.id),
			mapping=self._serialize_for_redis(free_plan.model_dump(mode='json')),
		)

		# ── Admin developer ────────────────────────────────────────
		admin_dev = Developer(
			id=self._generate_id(),
			name='Admin',
			email='admin@fiscal-agent.local',
			auth0_id='',
			created_at=datetime.now(timezone.utc),
			is_active=True,
		)
		await self.redis.hset(
			_KEY_DEVELOPER.format(admin_dev.id),
			mapping=self._serialize_for_redis(admin_dev.model_dump(mode='json')),
		)
		await self.redis.set(_KEY_DEV_BY_EMAIL.format(admin_dev.email), admin_dev.id)

		# ── Admin app ──────────────────────────────────────────────
		admin_app = App(
			id=self._generate_id(),
			developer_id=admin_dev.id,
			name='Admin App',
			environment='production',
			status='active',
		)
		await self.redis.hset(
			_KEY_APP.format(admin_app.id),
			mapping=self._serialize_for_redis(admin_app.model_dump(mode='json')),
		)
		await self.redis.sadd(_KEY_DEV_APPS.format(admin_dev.id), admin_app.id)

		# ── Admin API key (full scopes) ────────────────────────────
		full_key = f'fa_{secrets.token_hex(16)}'
		admin_key = ApiKey(
			id=self._generate_id(),
			app_id=admin_app.id,
			key_preview=full_key[-4:],
			is_active=True,
			scopes=list(Scope),
			created_at=datetime.now(timezone.utc),
		)
		await self.redis.hset(
			_KEY_APIKEY.format(admin_key.id),
			mapping=self._serialize_for_redis(admin_key.model_dump(mode='json')),
		)
		await self.redis.set(_KEY_KEYHASH.format(self._hash_key(full_key)), admin_key.id)
		await self.redis.sadd(_KEY_APP_KEYS.format(admin_app.id), admin_key.id)

		logger.info('Admin API key creada: %s', full_key)
