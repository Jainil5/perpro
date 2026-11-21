"""One JSON encoder for the whole API.

FastAPI's default encoder writes ``+00:00`` offsets and chokes on ``Decimal``;
API.md wants ``...Z``. Setting :class:`ZJSONResponse` as the application's
default response class (and giving every response model an explicit
``UtcDateTime`` serializer) means the contract holds whether a value went
through a Pydantic model or was returned as a plain dict.
"""

from __future__ import annotations

import datetime as dt
import json
from decimal import Decimal
from enum import Enum
from typing import Any

from fastapi.responses import JSONResponse

from app.core.utils import to_utc_iso


def json_default(obj: Any) -> Any:
    """Fallback serializer: UTC instants with ``Z``, dates, Decimals and Enums."""
    if isinstance(obj, dt.datetime):
        return to_utc_iso(obj)
    if isinstance(obj, dt.date):
        return obj.isoformat()
    if isinstance(obj, dt.time):
        return obj.isoformat()
    if isinstance(obj, Decimal):
        return float(obj)
    if isinstance(obj, Enum):
        return obj.value
    if isinstance(obj, (set, frozenset)):
        return sorted(obj)
    if isinstance(obj, bytes):
        return obj.decode("utf-8", errors="replace")
    raise TypeError(f"Object of type {type(obj).__name__} is not JSON serializable")


def dumps(payload: Any) -> str:
    return json.dumps(payload, default=json_default, ensure_ascii=False, separators=(",", ":"))


class ZJSONResponse(JSONResponse):
    media_type = "application/json"

    def render(self, content: Any) -> bytes:  # noqa: D401 - JSONResponse contract
        return dumps(content).encode("utf-8")


def zjson(content: Any, status_code: int = 200, headers: dict[str, str] | None = None) -> ZJSONResponse:
    return ZJSONResponse(content=content, status_code=status_code, headers=headers)
