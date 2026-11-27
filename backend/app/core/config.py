"""Environment-driven configuration.

Every value has a sane local default so ``uvicorn app.main:app`` works with no
environment at all. Nothing here reads secrets from source: credentials (AI keys,
database passwords) come from the environment only.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy.engine import make_url

# backend/  (the directory alembic.ini and ./data live in)
BACKEND_DIR = Path(__file__).resolve().parents[2]
PROJECT_ROOT = BACKEND_DIR.parent

APP_VERSION = "0.1.0"

DEFAULT_SQLITE_URL = "sqlite:///./data/myos.db"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="MYOS_",
        env_file=(BACKEND_DIR / ".env"),
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # --- storage -------------------------------------------------------------
    database_url: str = Field(default=DEFAULT_SQLITE_URL, description="SQLAlchemy URL")
    data_dir: Path = Field(default=BACKEND_DIR / "data", description="SQLite / export directory")

    # --- tenancy & locale ----------------------------------------------------
    workspace: str = Field(default="default", description="Phase 1 single-workspace slug")
    timezone: str = Field(default="Asia/Kolkata")
    currency: str = Field(default="INR")

    # --- AI (optional by design) ---------------------------------------------
    ai_enabled: bool = False
    ai_provider: Literal["openai", "ollama"] = "openai"
    ai_model: str = "gpt-4o-mini"
    ai_base_url: str | None = None
    ai_api_key: str | None = None  # env only, never committed

    # --- Finance (optional by design, same shape as AI) ----------------------
    #: POST /exchange-rates/sync is the only Finance call that may touch the network.
    #: Unset by default, so the module is offline-first and answers 503 not_configured.
    rates_url: str | None = None

    # --- behaviour switches --------------------------------------------------
    allow_demo_reset: bool = Field(
        default=False, description="Guard for POST /demo/reset (409 when false)"
    )
    auto_create: bool = Field(
        default=True,
        description="Dev/test bootstrap: create_all(checkfirst=True) on startup. "
        "Set to 0 in production, where `alembic upgrade head` is the schema path.",
    )
    api_prefix: str = "/api/v1"

    @field_validator("workspace", "timezone", "currency")
    @classmethod
    def _not_blank(cls, value: str, info) -> str:
        value = (value or "").strip()
        if not value:
            raise ValueError(f"{info.field_name} must not be blank")
        return value

    @field_validator("data_dir")
    @classmethod
    def _abs_data_dir(cls, value: Path) -> Path:
        value = Path(value)
        return value if value.is_absolute() else (BACKEND_DIR / value).resolve()

    @property
    def is_sqlite(self) -> bool:
        return self.database_url.startswith("sqlite")

    @property
    def resolved_database_url(self) -> str:
        """``MYOS_DATABASE_URL`` with relative SQLite paths anchored at ``backend/``.

        ``sqlite:///./data/myos.db`` would otherwise follow the current working
        directory, which differs between pytest, uvicorn and the CLI.
        """
        url = make_url(self.database_url)
        database = url.database
        if url.drivername.startswith("sqlite") and database not in (None, "", ":memory:"):
            path = Path(database)
            if not path.is_absolute():
                path = (BACKEND_DIR / path).resolve()
            return str(url.set(database=str(path)))
        return self.database_url

    @property
    def database_family(self) -> str:
        """Value reported by ``GET /health`` -> ``database``."""
        return make_url(self.database_url).drivername.split("+")[0]

    @property
    def sqlite_file(self) -> Path | None:
        """Path of the SQLite file, if this is a file-based SQLite database."""
        if not self.is_sqlite:
            return None
        database = make_url(self.resolved_database_url).database
        if not database or database == ":memory:":
            return None
        return Path(database)


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()


def reload_settings() -> Settings:
    """Drop the cached settings (used by the test fixtures after changing env)."""
    get_settings.cache_clear()
    return get_settings()
