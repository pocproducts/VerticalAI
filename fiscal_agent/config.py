"""Centralized configuration via Pydantic BaseSettings.

Single source of truth for all environment variables.
Sub-models group related config: Redis, credentials, etc.
"""

from __future__ import annotations

from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class RedisConfig(BaseSettings):
	"""Redis connection configuration (sync + async).

	Env vars:
	  - ``REDIS_URL`` for async ``RedisStore`` (api/server.py)
	  - ``MEMORY_REDIS_CACHE_URL`` for sync cache (memory/client.py)
	  - ``MEMORY_REDIS_MAX_MB`` memory limit for cache writes
	"""

	model_config = SettingsConfigDict(extra='ignore')

	url: str = Field(default='redis://localhost:6379/0', alias='REDIS_URL')
	cache_url: str = Field(default='redis://localhost:6379/0', alias='MEMORY_REDIS_CACHE_URL')
	max_mb: int = Field(default=25, alias='MEMORY_REDIS_MAX_MB')


class Credentials(BaseSettings):
	"""Estudio contable credentials and API keys.

	Env vars:
	  - ``ESTUDIO_CUIT`` — CUIT del estudio (representante legal)
	  - ``ESTUDIO_CLAVE_FISCAL`` — clave fiscal del estudio
	  - ``COMPOSIO_API_KEY`` — API key de Composio (browser automation)
	"""

	model_config = SettingsConfigDict(extra='ignore')

	cuit: str = Field(default='20324837796', alias='ESTUDIO_CUIT')
	clave_fiscal: str = Field(default='', alias='ESTUDIO_CLAVE_FISCAL')
	composio_api_key: str = Field(default='', alias='COMPOSIO_API_KEY')


class AppSettings(BaseSettings):
	"""Top-level application settings.

	Loads from ``.env`` file automatically. Aggregates all sub-configs.
	"""

	model_config = SettingsConfigDict(env_file='.env', extra='ignore')

	redis: RedisConfig = RedisConfig()
	credentials: Credentials = Credentials()


@lru_cache
def get_settings() -> AppSettings:
	"""Return cached AppSettings singleton.

	LRU-cached so repeated calls don't re-parse env vars.
	Use ``monkeypatch`` in tests to override individual fields.
	"""
	return AppSettings()
