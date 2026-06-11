"""Postgres access for forecasting (Chunk 6.2). The ML service is a trusted backend: it connects with
a privileged URL and enforces tenant scoping with explicit `tenant_id` filters (the API bridge, which
is itself authenticated, passes the tenant). Reads OUT-movement demand history; reads/writes the
precomputed `ml_demand_forecast` rows.
"""
from __future__ import annotations

import datetime as dt
import json

import psycopg

from .config import get_settings

SENTINEL_WAREHOUSE = "00000000-0000-0000-0000-000000000000"


class DatabaseUnavailable(RuntimeError):
    """Raised when no database URL is configured (forecast features require one)."""


def _connect() -> psycopg.Connection:
    url = get_settings().effective_database_url()
    if not url:
        raise DatabaseUnavailable("No ML_DATABASE_URL / DATABASE_URL configured")
    return psycopg.connect(url)


def _daily_series(rows: list[tuple[dt.date, int]]) -> tuple[list[dt.date], list[float]]:
    """Zero-fill a sparse (date, qty) list into an evenly-spaced daily series."""
    if not rows:
        return [], []
    start, end = rows[0][0], rows[-1][0]
    by_date = {d: float(q) for d, q in rows}
    dates: list[dt.date] = []
    values: list[float] = []
    cur = start
    while cur <= end:
        dates.append(cur)
        values.append(by_date.get(cur, 0.0))
        cur += dt.timedelta(days=1)
    return dates, values


def fetch_demand_history(
    tenant_id: str, product_id: str, warehouse_id: str
) -> tuple[list[dt.date], list[float]]:
    """Daily OUT-movement demand for a product (all warehouses when the sentinel is given)."""
    all_warehouses = warehouse_id == SENTINEL_WAREHOUSE
    with _connect() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT date(created_at) AS d, SUM(quantity)::int AS q
            FROM inventory_stock_movement
            WHERE tenant_id = %(t)s AND product_id = %(p)s AND type = 'OUT'
              AND (%(all)s OR warehouse_id = %(w)s)
            GROUP BY date(created_at)
            ORDER BY d
            """,
            {"t": tenant_id, "p": product_id, "all": all_warehouses, "w": warehouse_id},
        )
        rows = [(r[0], r[1]) for r in cur.fetchall()]
    return _daily_series(rows)


def distinct_products() -> list[tuple[str, str]]:
    """(tenant_id, product_id) pairs that have OUT demand — what the refresh job fits."""
    with _connect() as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT DISTINCT tenant_id::text, product_id::text FROM inventory_stock_movement WHERE type = 'OUT'"
        )
        return [(r[0], r[1]) for r in cur.fetchall()]


def upsert_forecast(
    tenant_id: str,
    product_id: str,
    warehouse_id: str,
    horizon: int,
    model: str,
    history_points: int,
    forecast: dict,
) -> None:
    with _connect() as conn, conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO ml_demand_forecast
              (tenant_id, product_id, warehouse_id, horizon, model, history_points, forecast, fitted_at)
            VALUES (%(t)s, %(p)s, %(w)s, %(h)s, %(m)s, %(n)s, %(f)s, now())
            ON CONFLICT (tenant_id, product_id, warehouse_id)
            DO UPDATE SET horizon = EXCLUDED.horizon, model = EXCLUDED.model,
                          history_points = EXCLUDED.history_points, forecast = EXCLUDED.forecast,
                          fitted_at = now(), updated_at = now()
            """,
            {
                "t": tenant_id,
                "p": product_id,
                "w": warehouse_id,
                "h": horizon,
                "m": model,
                "n": history_points,
                "f": json.dumps(forecast),
            },
        )
        conn.commit()


def fetch_transaction_amounts(
    tenant_id: str, date_from: str | None, date_to: str | None
) -> list[tuple[str, int, str]]:
    """(transaction_id, amount_minor, occurred_on) — amount = total debits per transaction."""
    with _connect() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT t.id::text, COALESCE(SUM(je.debit_minor), 0)::bigint AS amount, t.occurred_on
            FROM finance_transaction t
            JOIN finance_journal_entry je ON je.transaction_id = t.id AND je.deleted_at IS NULL
            WHERE t.tenant_id = %(t)s AND t.deleted_at IS NULL
              AND (%(f)s::date IS NULL OR t.occurred_on >= %(f)s::date)
              AND (%(to)s::date IS NULL OR t.occurred_on <= %(to)s::date)
            GROUP BY t.id, t.occurred_on
            ORDER BY t.occurred_on
            """,
            {"t": tenant_id, "f": date_from, "to": date_to},
        )
        return [(r[0], int(r[1]), r[2].isoformat() if r[2] else "") for r in cur.fetchall()]


def get_forecast(tenant_id: str, product_id: str, warehouse_id: str) -> dict | None:
    with _connect() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT horizon, model, history_points, forecast, fitted_at
            FROM ml_demand_forecast
            WHERE tenant_id = %(t)s AND product_id = %(p)s AND warehouse_id = %(w)s
            """,
            {"t": tenant_id, "p": product_id, "w": warehouse_id},
        )
        row = cur.fetchone()
    if not row:
        return None
    horizon, model, points, forecast, fitted_at = row
    return {
        "horizon": horizon,
        "model": model,
        "history_points": points,
        "forecast": forecast,
        "fitted_at": fitted_at.isoformat() if isinstance(fitted_at, dt.datetime) else str(fitted_at),
    }
