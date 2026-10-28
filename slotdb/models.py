"""Database schema (SQLAlchemy). Works on Postgres (Neon) in production and SQLite in tests/local dev."""
import os
from datetime import datetime, timezone
from sqlalchemy import JSON, Boolean, Float, ForeignKey, Index, Integer, String, UniqueConstraint, create_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker
from sqlalchemy.pool import NullPool


def db_url():
    url = os.environ.get("DATABASE_URL", "sqlite:///data/slotting.db")
    if url.startswith("postgres://"):
        url = "postgresql://" + url[len("postgres://"):]
    if url.startswith("postgresql://"):                      # use the psycopg 3 driver
        url = "postgresql+psycopg://" + url[len("postgresql://"):]
    return url


def make_engine(url=None):
    url = url or db_url()
    kw = {"poolclass": NullPool} if url.startswith("postgresql") else {}   # serverless: no pooled idle connections
    return create_engine(url, pool_pre_ping=True, **kw)


class Base(DeclarativeBase):
    pass


class Run(Base):
    __tablename__ = "runs"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    profile: Mapped[str] = mapped_column(String(40))
    dataset: Mapped[str] = mapped_column(String(80))
    created_at: Mapped[datetime] = mapped_column(default=lambda: datetime.now(timezone.utc))
    config: Mapped[dict] = mapped_column(JSON)
    summary: Mapped[dict] = mapped_column(JSON)


class Kpi(Base):
    __tablename__ = "kpis"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    run_id: Mapped[int] = mapped_column(ForeignKey("runs.id", ondelete="CASCADE"), index=True)
    policy: Mapped[str] = mapped_column(String(40))
    metric: Mapped[str] = mapped_column(String(60))
    value: Mapped[float] = mapped_column(Float)
    sd: Mapped[float | None] = mapped_column(Float, nullable=True)


class Ci(Base):
    __tablename__ = "cis"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    run_id: Mapped[int] = mapped_column(ForeignKey("runs.id", ondelete="CASCADE"), index=True)
    policy: Mapped[str] = mapped_column(String(40))
    routing: Mapped[str] = mapped_column(String(20))
    mean_dist_per_order: Mapped[float] = mapped_column(Float)
    ci_low: Mapped[float] = mapped_column(Float)
    ci_high: Mapped[float] = mapped_column(Float)
    reduction_pct: Mapped[float] = mapped_column(Float)
    reduction_ci_low: Mapped[float] = mapped_column(Float)
    reduction_ci_high: Mapped[float] = mapped_column(Float)


class Violation(Base):
    __tablename__ = "violations"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    run_id: Mapped[int] = mapped_column(ForeignKey("runs.id", ondelete="CASCADE"), index=True)
    policy: Mapped[str] = mapped_column(String(40))
    rule: Mapped[str] = mapped_column(String(40))
    count: Mapped[int] = mapped_column(Integer)


class Slot(Base):
    """One row per (run, policy, SKU): where the layout put it, denormalised for the heatmaps."""
    __tablename__ = "slots"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    run_id: Mapped[int] = mapped_column(ForeignKey("runs.id", ondelete="CASCADE"))
    policy: Mapped[str] = mapped_column(String(40))
    sku_id: Mapped[str] = mapped_column(String(40))
    location_id: Mapped[str] = mapped_column(String(40))
    aisle: Mapped[int] = mapped_column(Integer)
    side: Mapped[int] = mapped_column(Integer)
    bay: Mapped[int] = mapped_column(Integer)
    level: Mapped[int] = mapped_column(Integer)
    bin: Mapped[int] = mapped_column(Integer)
    x: Mapped[float] = mapped_column(Float)
    y: Mapped[float] = mapped_column(Float)
    velocity: Mapped[float] = mapped_column(Float)
    abc: Mapped[str] = mapped_column(String(1))
    category: Mapped[str] = mapped_column(String(40))
    hazard: Mapped[str] = mapped_column(String(20))
    __table_args__ = (Index("ix_slots_run_policy", "run_id", "policy"),)


class Artifact(Base):
    """JSON blobs the UI renders as-is: eda, forecast, reslot, sensitivity, paths."""
    __tablename__ = "artifacts"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    run_id: Mapped[int] = mapped_column(ForeignKey("runs.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(30))
    payload: Mapped[dict | list | None] = mapped_column(JSON, nullable=True)


class Explanation(Base):
    """Per-SKU cost breakdown for the headline layout (why this bin, and the best alternatives)."""
    __tablename__ = "explanations"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    run_id: Mapped[int] = mapped_column(ForeignKey("runs.id", ondelete="CASCADE"))
    sku_id: Mapped[str] = mapped_column(String(40))
    payload: Mapped[dict] = mapped_column(JSON)
    __table_args__ = (Index("ix_expl_run_sku", "run_id", "sku_id"),)


class RunLog(Base):
    __tablename__ = "run_log"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    run_id: Mapped[int] = mapped_column(ForeignKey("runs.id", ondelete="CASCADE"), index=True)
    step: Mapped[str] = mapped_column(String(40))
    seconds: Mapped[float] = mapped_column(Float)


# ---------------------------------------------------------------------------------------------------------------------------
# Live operations: the warehouse as it is right now (bins, SKUs, where each SKU sits, stock, orders, work orders).
# The experiment tables above are results computed offline; these tables are mutable state, and every change to stock is
# recorded in the append-only stock_movements table. `warehouse_id` is on every table so several sites can share one database.
# ---------------------------------------------------------------------------------------------------------------------------
RESERVE = "RESERVE"      # stock location for units that are not in the pick face (bulk / back-up storage)


def _now():
    """Naive UTC: every timestamp in the live tables is UTC without a zone, so rows compare the same on Postgres and SQLite."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


class Warehouse(Base):
    __tablename__ = "warehouses"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    created_at: Mapped[datetime] = mapped_column(default=_now)
    config: Mapped[dict] = mapped_column(JSON)               # engine config (ergonomic weights, heavy limit, ...) plus live settings
    source: Mapped[str] = mapped_column(String(30), default="import")   # 'import' | 'demo'


class Bin(Base):
    """One storage bin / pick face. Column names follow the engine's location table (see core/ingest.py)."""
    __tablename__ = "bins"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    warehouse_id: Mapped[int] = mapped_column(ForeignKey("warehouses.id", ondelete="CASCADE"))
    loc_id: Mapped[str] = mapped_column(String(40))
    zone: Mapped[str] = mapped_column(String(4))
    aisle: Mapped[int] = mapped_column(Integer)
    side: Mapped[int] = mapped_column(Integer)
    rack_id: Mapped[str] = mapped_column(String(40))
    bay: Mapped[int] = mapped_column(Integer)
    level: Mapped[int] = mapped_column(Integer)
    bin_no: Mapped[int] = mapped_column(Integer)
    x: Mapped[float] = mapped_column(Float)
    y: Mapped[float] = mapped_column(Float)
    z: Mapped[float] = mapped_column(Float)
    aisle_x: Mapped[float] = mapped_column(Float)
    bin_w: Mapped[float] = mapped_column(Float)
    bin_h: Mapped[float] = mapped_column(Float)
    bin_d: Mapped[float] = mapped_column(Float)
    vol_cap: Mapped[float] = mapped_column(Float)
    max_weight: Mapped[float] = mapped_column(Float)
    dist_depot: Mapped[float] = mapped_column(Float)
    beam_id: Mapped[str] = mapped_column(String(50))
    beam_cap: Mapped[float] = mapped_column(Float)
    frame_cap: Mapped[float] = mapped_column(Float)
    __table_args__ = (UniqueConstraint("warehouse_id", "loc_id", name="uq_bin_loc"),)


class Sku(Base):
    __tablename__ = "skus"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    warehouse_id: Mapped[int] = mapped_column(ForeignKey("warehouses.id", ondelete="CASCADE"))
    sku_id: Mapped[str] = mapped_column(String(40))
    name: Mapped[str | None] = mapped_column(String(160), nullable=True)
    width: Mapped[float] = mapped_column(Float)
    height: Mapped[float] = mapped_column(Float)
    depth: Mapped[float] = mapped_column(Float)
    weight: Mapped[float] = mapped_column(Float)
    category: Mapped[str] = mapped_column(String(40))
    hazard: Mapped[str] = mapped_column(String(20))
    handling: Mapped[str] = mapped_column(String(20))
    cases: Mapped[int] = mapped_column(Integer, default=1)               # cases held in the pick face (engine meaning)
    units_per_case: Mapped[int] = mapped_column(Integer, default=1)      # stock is counted in units
    dims_estimated: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(default=_now)
    __table_args__ = (UniqueConstraint("warehouse_id", "sku_id", name="uq_sku"),)


class Assignment(Base):
    """Which bin is the pick face of which SKU. One SKU, one bin; the unique constraints make double booking impossible."""
    __tablename__ = "assignments"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    warehouse_id: Mapped[int] = mapped_column(ForeignKey("warehouses.id", ondelete="CASCADE"))
    sku_id: Mapped[str] = mapped_column(String(40))
    loc_id: Mapped[str] = mapped_column(String(40))
    assigned_at: Mapped[datetime] = mapped_column(default=_now)
    __table_args__ = (UniqueConstraint("warehouse_id", "sku_id", name="uq_assign_sku"),
                      UniqueConstraint("warehouse_id", "loc_id", name="uq_assign_loc"))


class Stock(Base):
    """Units on hand at a location (a bin loc_id, or RESERVE). A cache of the movement log: reconcile() proves they agree."""
    __tablename__ = "stock"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    warehouse_id: Mapped[int] = mapped_column(ForeignKey("warehouses.id", ondelete="CASCADE"))
    sku_id: Mapped[str] = mapped_column(String(40))
    location: Mapped[str] = mapped_column(String(40))
    qty: Mapped[int] = mapped_column(Integer, default=0)
    updated_at: Mapped[datetime] = mapped_column(default=_now)
    __table_args__ = (UniqueConstraint("warehouse_id", "sku_id", "location", name="uq_stock"),
                      Index("ix_stock_wh_loc", "warehouse_id", "location"))


class StockMovement(Base):
    """Append-only audit trail. Never updated or deleted: stock is whatever the movements add up to."""
    __tablename__ = "stock_movements"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    warehouse_id: Mapped[int] = mapped_column(ForeignKey("warehouses.id", ondelete="CASCADE"))
    ts: Mapped[datetime] = mapped_column(default=_now)
    type: Mapped[str] = mapped_column(String(10))            # receive | pick | move | adjust
    sku_id: Mapped[str] = mapped_column(String(40))
    from_loc: Mapped[str | None] = mapped_column(String(40), nullable=True)
    to_loc: Mapped[str | None] = mapped_column(String(40), nullable=True)
    qty: Mapped[int] = mapped_column(Integer)
    ref: Mapped[str | None] = mapped_column(String(60), nullable=True)
    note: Mapped[str | None] = mapped_column(String(240), nullable=True)
    lot: Mapped[str | None] = mapped_column(String(40), nullable=True)
    expiry: Mapped[str | None] = mapped_column(String(10), nullable=True)
    __table_args__ = (Index("ix_mov_wh_ts", "warehouse_id", "ts"), Index("ix_mov_wh_sku", "warehouse_id", "sku_id"))


class OrderLine(Base):
    """Demand history: imported history and every order picked through the API. Feeds velocity, affinity and forecasts."""
    __tablename__ = "order_lines"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    warehouse_id: Mapped[int] = mapped_column(ForeignKey("warehouses.id", ondelete="CASCADE"))
    order_id: Mapped[str] = mapped_column(String(60))
    sku_id: Mapped[str] = mapped_column(String(40))
    qty: Mapped[int] = mapped_column(Integer)
    ts: Mapped[datetime] = mapped_column()
    source: Mapped[str] = mapped_column(String(10), default="live")     # history | live
    __table_args__ = (Index("ix_ol_wh_ts", "warehouse_id", "ts"), Index("ix_ol_wh_sku", "warehouse_id", "sku_id"))


class ReorderRule(Base):
    __tablename__ = "reorder_rules"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    warehouse_id: Mapped[int] = mapped_column(ForeignKey("warehouses.id", ondelete="CASCADE"))
    sku_id: Mapped[str] = mapped_column(String(40))
    reorder_point: Mapped[int] = mapped_column(Integer)      # supplier reorder when total on hand is at or below this
    lead_days: Mapped[int] = mapped_column(Integer, default=7)
    __table_args__ = (UniqueConstraint("warehouse_id", "sku_id", name="uq_reorder"),)


class Task(Base):
    """Work for the floor: replenish a pick face from reserve, or move products to better bins (re-slotting)."""
    __tablename__ = "tasks"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    warehouse_id: Mapped[int] = mapped_column(ForeignKey("warehouses.id", ondelete="CASCADE"))
    type: Mapped[str] = mapped_column(String(12))            # replenish | move
    sku_id: Mapped[str] = mapped_column(String(40))
    from_loc: Mapped[str] = mapped_column(String(40))
    to_loc: Mapped[str] = mapped_column(String(40))
    qty: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(12), default="open")      # open | done | rejected | stale | superseded
    group_id: Mapped[int | None] = mapped_column(Integer, nullable=True)  # the two halves of a swap share one group
    saving: Mapped[float] = mapped_column(Float, default=0.0)             # estimated weekly saving, metre-equivalents
    reason: Mapped[str | None] = mapped_column(String(240), nullable=True)
    job_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(default=_now)
    done_at: Mapped[datetime | None] = mapped_column(nullable=True)
    __table_args__ = (Index("ix_task_wh_status", "warehouse_id", "status"),)


class Alert(Base):
    __tablename__ = "alerts"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    warehouse_id: Mapped[int] = mapped_column(ForeignKey("warehouses.id", ondelete="CASCADE"))
    kind: Mapped[str] = mapped_column(String(20))            # stockout | reorder | drift | reconcile
    key: Mapped[str] = mapped_column(String(80))             # one open alert per key
    severity: Mapped[str] = mapped_column(String(8), default="warn")      # info | warn | high
    message: Mapped[str] = mapped_column(String(300))
    created_at: Mapped[datetime] = mapped_column(default=_now)
    resolved_at: Mapped[datetime | None] = mapped_column(nullable=True)
    __table_args__ = (Index("ix_alert_wh_open", "warehouse_id", "resolved_at"),)


class JobRun(Base):
    __tablename__ = "job_runs"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    warehouse_id: Mapped[int] = mapped_column(ForeignKey("warehouses.id", ondelete="CASCADE"))
    kind: Mapped[str] = mapped_column(String(20))            # reslot | reconcile
    started_at: Mapped[datetime] = mapped_column(default=_now)
    finished_at: Mapped[datetime | None] = mapped_column(nullable=True)
    status: Mapped[str] = mapped_column(String(10), default="running")   # running | ok | failed
    summary: Mapped[dict | None] = mapped_column(JSON, nullable=True)


class LiveMeta(Base):
    """Small cached values per warehouse (for example the bought-together partner table)."""
    __tablename__ = "live_meta"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    warehouse_id: Mapped[int] = mapped_column(ForeignKey("warehouses.id", ondelete="CASCADE"))
    key: Mapped[str] = mapped_column(String(40))
    value: Mapped[dict | list | None] = mapped_column(JSON, nullable=True)
    __table_args__ = (UniqueConstraint("warehouse_id", "key", name="uq_meta"),)


class IdempotencyKey(Base):
    """A retried write returns the stored answer instead of being applied twice."""
    __tablename__ = "idempotency_keys"
    key: Mapped[str] = mapped_column(String(80), primary_key=True)
    response: Mapped[dict | list | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(default=_now)


def session_factory(engine):
    Base.metadata.create_all(engine)
    return sessionmaker(engine, expire_on_commit=False)
