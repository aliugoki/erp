"""Restaurant AI (Phase 10). Three models over the live restaurant schema, tenant-scoped:

  • demand   — daily menu-item order volume → forecast the next N days (reuses `forecasting`).
  • prep-time — expected kitchen time for an item = median of historical fired→ready durations,
                blended with the recipe estimate and the station's current queue load.
  • upsell   — market-basket: items frequently ordered alongside the basket (confidence + lift).

The service is a trusted backend (ADR-006): it connects with a privileged URL and scopes every read by
an explicit `tenant_id` the authenticated API passes in.
"""
from __future__ import annotations

import datetime as dt
from collections import defaultdict

from .db import _connect
from .forecasting import forecast_demand


# ── DB reads ─────────────────────────────────────────────────────────────────
def fetch_item_demand_daily(tenant_id: str, item_id: str) -> list[tuple[dt.date, float]]:
    """Daily units sold of a menu item (non-void lines on non-void orders)."""
    with _connect() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT date_trunc('day', o.created_at)::date AS d, SUM(oi.qty)::float AS qty
            FROM restaurant_order_item oi
            JOIN restaurant_order o ON o.id = oi.order_id
            WHERE o.tenant_id = %(t)s AND oi.item_id = %(i)s
              AND oi.status <> 'VOID' AND o.status <> 'VOID' AND o.deleted_at IS NULL
            GROUP BY 1 ORDER BY 1
            """,
            {"t": tenant_id, "i": item_id},
        )
        return [(r[0], float(r[1])) for r in cur.fetchall()]


def fetch_prep_seconds(tenant_id: str, station_key: str | None) -> list[float]:
    """Historical fired→ready durations (seconds) for completed KDS tickets, optionally by station."""
    with _connect() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT EXTRACT(EPOCH FROM (ready_at - fired_at))::float
            FROM restaurant_kds_ticket
            WHERE tenant_id = %(t)s AND fired_at IS NOT NULL AND ready_at IS NOT NULL
              AND (%(s)s::text IS NULL OR station_key = %(s)s::text)
            """,
            {"t": tenant_id, "s": station_key},
        )
        return [float(r[0]) for r in cur.fetchall() if r[0] is not None and r[0] > 0]


def fetch_station_queue(tenant_id: str, station_key: str | None) -> int:
    """Tickets currently QUEUED/PREPARING at the station — the live kitchen load."""
    with _connect() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT count(*) FROM restaurant_kds_ticket
            WHERE tenant_id = %(t)s AND status IN ('QUEUED','PREPARING') AND deleted_at IS NULL
              AND (%(s)s::text IS NULL OR station_key = %(s)s::text)
            """,
            {"t": tenant_id, "s": station_key},
        )
        return int(cur.fetchone()[0])


def fetch_item(tenant_id: str, item_id: str) -> tuple[str, int, str | None] | None:
    with _connect() as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT name, prep_minutes, station_key FROM restaurant_menu_item "
            "WHERE tenant_id = %(t)s AND id = %(i)s AND deleted_at IS NULL",
            {"t": tenant_id, "i": item_id},
        )
        r = cur.fetchone()
        return (r[0], int(r[1]), r[2]) if r else None


def fetch_order_baskets(tenant_id: str) -> list[list[str]]:
    """Each order's set of item names — the transactions for market-basket analysis."""
    with _connect() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT oi.order_id, oi.name
            FROM restaurant_order_item oi JOIN restaurant_order o ON o.id = oi.order_id
            WHERE o.tenant_id = %(t)s AND oi.status <> 'VOID' AND o.status <> 'VOID' AND o.deleted_at IS NULL
            """,
            {"t": tenant_id},
        )
        by_order: dict[str, set[str]] = defaultdict(set)
        for order_id, name in cur.fetchall():
            by_order[order_id].add(name)
        return [sorted(s) for s in by_order.values()]


# ── Compute ──────────────────────────────────────────────────────────────────
def _daily_counts(rows: list[tuple[dt.date, float]]) -> list[float]:
    """Fill gaps between the first and last day with zeros so the series is evenly spaced."""
    if not rows:
        return []
    by_day = {d: q for d, q in rows}
    start, end = rows[0][0], rows[-1][0]
    out: list[float] = []
    day = start
    while day <= end:
        out.append(by_day.get(day, 0.0))
        day += dt.timedelta(days=1)
    return out


def demand_forecast(tenant_id: str, item_id: str, horizon: int) -> dict:
    history = _daily_counts(fetch_item_demand_daily(tenant_id, item_id))
    result = forecast_demand(history, horizon)
    total = round(sum(result.predicted), 1)
    return {
        "historyPoints": len(history),
        "model": result.model,
        "horizon": horizon,
        "forecast": [round(v, 2) for v in result.predicted],
        "expectedTotal": total,
    }


def predict_prep_time(tenant_id: str, item_id: str) -> dict:
    item = fetch_item(tenant_id, item_id)
    if item is None:
        raise ValueError("Unknown menu item for this tenant")
    name, recipe_minutes, station = item
    hist = sorted(fetch_prep_seconds(tenant_id, station))
    queue = fetch_station_queue(tenant_id, station)

    recipe_sec = recipe_minutes * 60
    if hist:
        median = hist[len(hist) // 2]
        # Blend the observed median with the recipe estimate (observed reality weighted higher).
        base = 0.7 * median + 0.3 * recipe_sec
        source = "history+recipe"
    else:
        base = float(recipe_sec)
        source = "recipe"
    # Each queued ticket adds ~35% of a base cook to the wait (kitchen contention).
    load_penalty = queue * base * 0.35
    eta = base + load_penalty
    return {
        "item": name,
        "station": station,
        "source": source,
        "samples": len(hist),
        "queueAhead": queue,
        "baseSeconds": round(base),
        "etaSeconds": round(eta),
        "etaMinutes": round(eta / 60, 1),
    }


def upsell(tenant_id: str, basket: list[str], top: int = 3) -> list[dict]:
    """Rank candidate add-ons by confidence P(candidate | basket-item), tie-broken by lift."""
    baskets = fetch_order_baskets(tenant_id)
    n = len(baskets)
    if n == 0:
        return []
    counts: dict[str, int] = defaultdict(int)
    pair: dict[tuple[str, str], int] = defaultdict(int)
    for b in baskets:
        for x in b:
            counts[x] += 1
        for i, x in enumerate(b):
            for y in b[i + 1 :]:
                pair[(x, y)] += 1
                pair[(y, x)] += 1

    basket_set = set(basket)
    scores: dict[str, float] = {}
    supports: dict[str, int] = {}
    for cand, c_total in counts.items():
        if cand in basket_set:
            continue
        best_conf = 0.0
        best_lift = 0.0
        support = 0
        for anchor in basket_set:
            co = pair.get((anchor, cand), 0)
            if co == 0 or counts.get(anchor, 0) == 0:
                continue
            conf = co / counts[anchor]           # P(cand | anchor)
            lift = conf / (c_total / n)          # vs. cand's baseline rate
            if conf > best_conf or (conf == best_conf and lift > best_lift):
                best_conf, best_lift, support = conf, lift, co
        if best_conf > 0:
            scores[cand] = best_conf
            supports[cand] = support
    ranked = sorted(scores.items(), key=lambda kv: kv[1], reverse=True)[:top]
    return [
        {"item": name, "confidence": round(conf, 3), "coOccurrences": supports[name]}
        for name, conf in ranked
    ]
