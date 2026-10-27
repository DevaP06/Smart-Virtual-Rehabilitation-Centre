import os
import numpy as np
import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
import streamlit as st
from core.config import CFG
from core.pipeline import run_all
from core.simulate import route_path, route_stats

st.set_page_config(page_title="Warehouse Slotting Engine", layout="wide")
st.title("Smart Warehouse Slotting & Optimization Engine")

with st.sidebar:
    st.header("Objective weights")
    lam = st.slider("Affinity weight (pick-together)", 0.0, 2.0, CFG["lam_aff"], 0.1)
    mu = st.slider("Best-fit weight (fill rate)", 0.0, 3.0, CFG["mu_fill"], 0.1)
    seed = st.number_input("Data seed", 0, 999, CFG["seed"])
    REAL = "data/raw/online_retail_II.csv"
    src = st.radio("Orders", ["Synthetic", "Online Retail II (real)"] if os.path.exists(REAL) else ["Synthetic"])


@st.cache_data(show_spinner="Running optimizer...")
def go_run(lam, mu, seed, real):
    c = {**CFG, "lam_aff": lam, "mu_fill": mu, "seed": seed}
    return run_all(c, orders_path=REAL if real else None, regen=True), c


R, C = go_run(lam, mu, seed, src != "Synthetic")
base, opt = "random (feasible)", "optimized"
tabs = st.tabs(["KPIs", "Layout", "Pick path", "EDA", "Constraints", "Download"])

with tabs[0]:
    res = R["results"]
    b, o = res.loc[base], res.loc[opt]
    c1, c2, c3, c4 = st.columns(4)
    c1.metric("Travel distance", f"{o.total_distance_m/1000:.0f} km", f"{100*(o.total_distance_m/b.total_distance_m-1):.1f}%", delta_color="inverse")
    c2.metric("Avg route time", f"{o.avg_route_time_s:.0f} s", f"{100*(o.avg_route_time_s/b.avg_route_time_s-1):.1f}%", delta_color="inverse")
    c3.metric("Fill rate", f"{o.fill_rate_pct:.1f}%", f"{o.fill_rate_pct-b.fill_rate_pct:+.1f} pts")
    c4.metric("Rule violations", int(o.violations), f"baseline {int(b.violations)}", delta_color="off")
    st.caption(f"Evaluated on {R['test'].Order_ID.nunique():,} held-out orders; the layout was learned on the earlier "
               f"{R['train'].Order_ID.nunique():,}. Random baseline distance varies by ±{R['random_dist_std']/1000:.1f} km across seeds.")
    st.dataframe(res.round(1))
    st.plotly_chart(px.bar(res.reset_index(), x="index", y="total_distance_m", title="Total pick distance (m), test orders",
                           labels={"index": "layout"}), use_container_width=True)

with tabs[1]:
    lv = st.selectbox("Shelf level", ["all"] + [1, 2, 3, 4, 5])
    cols = st.columns(2)
    grids = {}
    for name in (base, opt):
        a = R["layouts"][name].merge(R["locs"], on="Location_ID")
        a["v"] = a.SKU_ID.map(R["vel"]).fillna(0)
        if lv != "all":
            a = a[a.Shelf_Level == lv]
        a["col"] = a.Aisle_Number * 2 + a.Side
        grids[name] = a.pivot_table(index="Bay", columns="col", values="v", aggfunc="sum").reindex(
            index=range(C["bays"]), columns=range(C["aisles"] * 2)).fillna(0)
    zmax = float(np.log1p(max(g.values.max() for g in grids.values())))
    for col, name in zip(cols, (base, opt)):
        z = grids[name]
        # demand is heavily skewed, so colour by log1p; same scale in both panels so they compare fairly
        fig = go.Figure(go.Heatmap(
            z=np.log1p(z.values), x=list(z.columns), y=list(z.index), zmin=0, zmax=zmax, colorscale="Viridis",
            customdata=z.values, hovertemplate="col %{x}, bay %{y}<br>%{customdata:.0f} pick lines<extra></extra>",
            colorbar=dict(title=dict(text="log(1+picks)", font=dict(color="white")), bgcolor="rgba(0,0,0,0)",
                          outlinewidth=0, tickfont=dict(color="white"))))
        fig.update_layout(
            title=dict(text=name, font=dict(color="white")), height=520, paper_bgcolor="#111", plot_bgcolor="#111",
            font=dict(color="white"), hoverlabel=dict(bgcolor="#333", font=dict(color="white")),
            xaxis=dict(title="aisle column (2 sides per aisle)", tickfont=dict(color="white"), showgrid=False),
            yaxis=dict(title="bay (0 = nearest depot)", tickfont=dict(color="white"), showgrid=False))
        col.plotly_chart(fig, use_container_width=True, theme=None)
    st.caption("Brighter = more demand stored in that rack face (log scale). Optimized should glow near the depot (bottom-left), in golden-zone levels.")

with tabs[2]:
    multi = R["test"].groupby("Order_ID").size()
    oid = st.selectbox("Order (multi-line orders)", multi[multi >= 4].index[:50])
    fig = go.Figure()
    for name in (base, opt):
        p = route_path(oid, R["test"], R["layouts"][name], R["locs"])
        d = sum(abs(p[i][0]-p[i+1][0]) + abs(p[i][1]-p[i+1][1]) for i in range(len(p)-1))
        fig.add_trace(go.Scatter(x=[q[0] for q in p], y=[q[1] for q in p], mode="lines+markers", name=f"{name}: {d:.0f} m"))
    fig.add_trace(go.Scatter(x=[0], y=[0], mode="markers", marker=dict(size=14, symbol="star"), name="depot"))
    fig.update_layout(xaxis_title="x (m)", yaxis_title="y (m, up the aisle)")
    st.plotly_chart(fig, use_container_width=True)

with tabs[3]:
    v = R["vel"].sort_values(ascending=False)
    cum = v.cumsum() / v.sum() * 100
    st.plotly_chart(px.line(x=np.arange(1, len(v) + 1) / len(v) * 100, y=cum.values, title="Pareto: % of demand vs % of SKUs",
                            labels={"x": "% SKUs", "y": "% pick lines"}), use_container_width=True)
    st.write(R["abc"].value_counts().rename("SKUs per class").to_frame().T)
    top = list(v.index[:30])
    m = pd.DataFrame(0, index=top, columns=top)
    for (a, b2), n in R["pairs"].items():
        if a in m.index and b2 in m.index:
            m.loc[a, b2] = m.loc[b2, a] = n
    st.plotly_chart(px.imshow(m, title="Co-occurrence of the 30 fastest SKUs", color_continuous_scale="Blues"), use_container_width=True)
    S = R["skus"]
    vol = S.Width * S.Height * S.Depth * S.Cases / 1000
    h = px.histogram(vol, nbins=40, title="SKU stored volume (L) vs bin classes", labels={"value": "litres"})
    for k, d in C["bin_dims"].items():
        h.add_vline(x=d[0] * d[1] * d[2] / 1000, annotation_text=f"bin {k}")
    st.plotly_chart(h, use_container_width=True)

with tabs[4]:
    st.write("Violations per rule (independent validator):")
    st.dataframe(pd.DataFrame(R["validation"]))

with tabs[5]:
    st.download_button("Optimized assignment CSV", R["layouts"][opt].to_csv(index=False), "assignment_optimized.csv")
    st.download_button("KPIs CSV", R["results"].to_csv(), "kpis.csv")
