"""Service-to-service auth (ADR-006). Every functional ML endpoint requires the `x-service-token`
header that the NestJS API mints with `ServiceTokenService` — an HS256 JWT signed with the shared
SERVICE_AUTH_SECRET, audience `internal`, issuer `metaxperts-api`. A missing/invalid/expired token is
rejected with 401, so the ML service is never directly reachable by end users.
"""
from __future__ import annotations

import jwt
from fastapi import Header, HTTPException, status

from .config import SERVICE_AUDIENCE, SERVICE_ISSUER, get_settings


def require_service_token(x_service_token: str | None = Header(default=None)) -> dict:
    """FastAPI dependency: verify the API's service token or raise 401."""
    if not x_service_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing service token")
    settings = get_settings()
    try:
        return jwt.decode(
            x_service_token,
            settings.service_auth_secret,
            algorithms=["HS256"],
            audience=SERVICE_AUDIENCE,
            issuer=SERVICE_ISSUER,
        )
    except jwt.PyJWTError as exc:  # invalid signature / aud / iss / expired
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid service token") from exc
