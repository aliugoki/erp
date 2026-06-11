"""ML service tests (Chunk 6.1). Health is public; /ml/ping requires the API's signed service token.
Run: pip install -r requirements-dev.txt && pytest (from apps/ml).
"""
from __future__ import annotations

import datetime as dt

import jwt
from fastapi.testclient import TestClient

from app.config import SERVICE_AUDIENCE, SERVICE_ISSUER, get_settings
from app.main import app

client = TestClient(app)


def _token(secret: str | None = None, **overrides) -> str:
    settings = get_settings()
    claims = {
        "svc": "api",
        "aud": SERVICE_AUDIENCE,
        "iss": SERVICE_ISSUER,
        "exp": dt.datetime.now(dt.timezone.utc) + dt.timedelta(minutes=5),
        **overrides,
    }
    return jwt.encode(claims, secret or settings.service_auth_secret, algorithm="HS256")


def test_health_is_public():
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_ping_requires_token():
    assert client.get("/ml/ping").status_code == 401


def test_ping_rejects_bad_signature():
    assert client.get("/ml/ping", headers={"x-service-token": _token(secret="wrong-secret")}).status_code == 401


def test_ping_rejects_wrong_issuer():
    assert client.get("/ml/ping", headers={"x-service-token": _token(iss="someone-else")}).status_code == 401


def test_ping_accepts_valid_token():
    r = client.get("/ml/ping", headers={"x-service-token": _token()})
    assert r.status_code == 200
    body = r.json()
    assert body["pong"] is True
    assert body["caller"] == "api"
