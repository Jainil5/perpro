"""The single error contract from API.md.

Every failure leaves this process as::

    { "error": { "code": "not_found", "message": "task not found", "details": [] } }

with the HTTP status taken from ``_STATUS_CODES``: 404 ``not_found``,
409 ``conflict``, 422 ``validation_error``, 400 ``bad_request``,
503 ``not_configured`` (an optional integration that has no environment to run on),
500 ``internal_error`` (502 ``upstream_unavailable`` is produced by the Next proxy).
"""

from __future__ import annotations

from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

NOT_FOUND = "not_found"
CONFLICT = "conflict"
VALIDATION_ERROR = "validation_error"
BAD_REQUEST = "bad_request"
INTERNAL_ERROR = "internal_error"
#: Phase 3: an optional integration (rate sync) that no environment variable configures
NOT_CONFIGURED = "not_configured"

#: literal codes - Starlette's ``HTTP_422_UNPROCESSABLE_ENTITY`` alias is deprecated
HTTP_400 = 400
HTTP_404 = 404
HTTP_405 = 405
HTTP_409 = 409
HTTP_422 = 422
HTTP_500 = 500
HTTP_503 = 503

_STATUS_CODES: dict[str, int] = {
    NOT_FOUND: HTTP_404,
    CONFLICT: HTTP_409,
    VALIDATION_ERROR: HTTP_422,
    BAD_REQUEST: HTTP_400,
    NOT_CONFIGURED: HTTP_503,
    INTERNAL_ERROR: HTTP_500,
}


def error_body(code: str, message: str, details: list[Any] | None = None) -> dict[str, Any]:
    return {"error": {"code": code, "message": message, "details": details or []}}


def error_response(code: str, message: str, details: list[Any] | None = None) -> JSONResponse:
    status_code = _STATUS_CODES.get(code, _STATUS_CODES[INTERNAL_ERROR])
    return JSONResponse(status_code=status_code, content=error_body(code, message, details))


class ApiError(Exception):
    """Raise from services/routers to produce a contract-shaped error response."""

    def __init__(self, code: str, message: str, details: list[Any] | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.details = details or []
        self.status_code = _STATUS_CODES.get(code, _STATUS_CODES[INTERNAL_ERROR])

    def to_response(self) -> JSONResponse:
        return JSONResponse(
            status_code=self.status_code,
            content=error_body(self.code, self.message, self.details),
        )


def not_found(message: str = "resource not found", details: list[Any] | None = None) -> ApiError:
    return ApiError(NOT_FOUND, message, details)


def conflict(message: str, details: list[Any] | None = None) -> ApiError:
    return ApiError(CONFLICT, message, details)


def validation(message: str, details: list[Any] | None = None) -> ApiError:
    """A rule violation Pydantic cannot express, e.g. an FK id that does not exist."""
    return ApiError(VALIDATION_ERROR, message, details)


def field_error(loc: list[Any], msg: str, type_: str = "value_error") -> dict[str, Any]:
    dotted = ".".join(str(part) for part in loc if part != "body")
    return {"loc": [str(part) for part in loc if part != "body"], "field": dotted, "msg": msg, "type": type_}


_HTTP_MESSAGE_OVERRIDES = {
    HTTP_404: (NOT_FOUND, "resource not found"),
    HTTP_405: (NOT_FOUND, "method not allowed"),
    HTTP_409: (CONFLICT, "conflict"),
    HTTP_422: (VALIDATION_ERROR, "validation error"),
}


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def _api_error(_request: Request, exc: ApiError) -> JSONResponse:  # pragma: no cover - http glue
        return exc.to_response()

    @app.exception_handler(RequestValidationError)
    async def _validation_error(
        _request: Request, exc: RequestValidationError
    ) -> JSONResponse:  # pragma: no cover - http glue
        details = [
            {
                "loc": [str(part) for part in err.get("loc", ()) if part != "body"],
                "field": ".".join(str(part) for part in err.get("loc", ()) if part != "body"),
                "msg": str(err.get("msg", "invalid value")),
                "type": str(err.get("type", "value_error")),
            }
            for err in exc.errors()
        ]
        return JSONResponse(
            status_code=_STATUS_CODES[VALIDATION_ERROR],
            content=error_body(VALIDATION_ERROR, "request validation failed", details),
        )

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(
        _request: Request, exc: StarletteHTTPException
    ) -> JSONResponse:  # pragma: no cover - http glue
        code, message = _HTTP_MESSAGE_OVERRIDES.get(
            exc.status_code, (BAD_REQUEST if exc.status_code < 500 else INTERNAL_ERROR, str(exc.detail))
        )
        return error_response(code, message)

    @app.exception_handler(Exception)
    async def _unhandled(_request: Request, exc: Exception) -> JSONResponse:  # pragma: no cover - http glue
        return error_response(INTERNAL_ERROR, f"unexpected server error: {exc.__class__.__name__}")
