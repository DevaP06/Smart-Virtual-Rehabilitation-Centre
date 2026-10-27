"""Database schema (SQLAlchemy). Works on Postgres (Neon) in production and SQLite in tests/local dev."""
import os
from datetime import datetime, timezone
from sqlalchemy import JSON, Float, ForeignKey, Index, Integer, String, create_engine
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


class RunLog(Base):
    __tablename__ = "run_log"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    run_id: Mapped[int] = mapped_column(ForeignKey("runs.id", ondelete="CASCADE"), index=True)
    step: Mapped[str] = mapped_column(String(40))
    seconds: Mapped[float] = mapped_column(Float)


def session_factory(engine):
    Base.metadata.create_all(engine)
    return sessionmaker(engine, expire_on_commit=False)
