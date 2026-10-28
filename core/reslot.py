"""Re-slotting planner for a live warehouse: which products should change bins, given where demand is heading.

Same economics as the offline simulation (core/forecast.py: reslot_sim): a swap of a fast-moving SKU with a slow one in a closer
bin is only proposed when the weekly saving (predicted pick lines x change in bin cost) beats the cost of the move, every
rule is re-checked, and at most `budget` changes are proposed. Unlike the simulation it also proposes moving a fast SKU into a
FREE closer bin (a stocked warehouse always has some), which costs one handling instead of two.
Pure computation: takes the current state, returns proposals, changes nothing.
"""
import copy

import numpy as np

MOVE_COST = 150.0     # metre-equivalents per swap (two SKUs handled), as in the offline simulation; a relocation costs half


def propose(w, st, pred, budget=20, move_cost=MOVE_COST, exclude=(), n_hot=250, n_cold=60):
    """pred: dict SKU -> predicted pick lines next week. st is not modified.
    Returns a list of dicts, best first: kind 'swap' (a, b, from/to bins) or 'relocate' (a, to a free bin), with weekly_saving."""
    st = copy.deepcopy(st)
    sc = w.slot_cost
    names = [s for s in w.S.index if s in st.placed and w.hz[s] == "none" and s not in set(exclude)]
    p = {s: float(pred.get(s, 0.0)) for s in names}
    hot = sorted(names, key=lambda s: -p[s])[:n_hot]
    cold = sorted(names, key=lambda s: p[s])[:n_cold]
    masks = {}
    mask = lambda s: masks.setdefault(s, w.static_mask(s))
    cands = []
    for a in hot:
        ja = st.placed[a]
        for b in cold:
            jb = st.placed[b]
            if b == a or jb == ja or sc[jb] >= sc[ja]:
                continue
            gain = (p[a] - p[b]) * (sc[ja] - sc[jb]) - move_cost
            if gain > 0 and mask(a)[jb] and mask(b)[ja]:
                cands.append((gain, "swap", a, b))
        free_closer = np.flatnonzero(mask(a) & st.free & (sc < sc[ja]))
        if len(free_closer):
            jf = int(free_closer[np.argmin(sc[free_closer])])
            gain = p[a] * (sc[ja] - sc[jf]) - move_cost / 2
            if gain > 0:
                cands.append((gain, "relocate", a, jf))
    out, used, used_bins = [], set(), set()
    for gain, kind, a, b in sorted(cands, key=lambda c: -c[0]):
        if len(out) >= budget:
            break
        if a in used:
            continue
        ja = st.placed[a]
        if kind == "swap":
            if b in used:
                continue
            jb = st.placed[b]
            st.remove(a); st.remove(b)
            if st.ok(jb, a):
                st.place(jb, a)
                if st.ok(ja, b):
                    st.place(ja, b)
                    used |= {a, b}
                    out.append(dict(kind="swap", a=a, b=b, a_from=str(w.loc_ids[ja]), a_to=str(w.loc_ids[jb]),
                                    b_from=str(w.loc_ids[jb]), b_to=str(w.loc_ids[ja]), weekly_saving=float(gain + move_cost),
                                    net_saving=float(gain), pred_a=p[a], pred_b=p[b]))
                    continue
                st.remove(a)
            st.place(ja, a); st.place(jb, b)
        else:
            jf = b
            if jf in used_bins or not st.free[jf]:
                continue
            st.remove(a)
            if st.ok(jf, a):
                st.place(jf, a)
                used.add(a); used_bins.add(jf)
                out.append(dict(kind="relocate", a=a, b=None, a_from=str(w.loc_ids[ja]), a_to=str(w.loc_ids[jf]),
                                weekly_saving=float(gain + move_cost / 2), net_saving=float(gain), pred_a=p[a], pred_b=None))
            else:
                st.place(ja, a)
    return out


def layout_health(w, st, pred, far_pct=60):
    """How well the current layout matches current demand. Returns the share of 'fast' SKUs (those that together make up the top
    80% of predicted pick lines) sitting in far bins (bin cost above the `far_pct` percentile of all bins), and the A-class count."""
    sc = w.slot_cost
    items = sorted(((s, float(pred.get(s, 0.0))) for s in st.placed), key=lambda t: -t[1])
    total = sum(v for _, v in items)
    if total <= 0:
        return dict(fast_skus=0, far_fast_skus=0, far_share=0.0, far_threshold=float(np.percentile(sc, far_pct)))
    cut, acc, fast = 0.8 * total, 0.0, []
    for s, v in items:
        if acc >= cut:
            break
        fast.append(s)
        acc += v
    thr = float(np.percentile(sc, far_pct))
    far = [s for s in fast if sc[st.placed[s]] > thr]
    return dict(fast_skus=len(fast), far_fast_skus=len(far), far_share=len(far) / len(fast), far_threshold=thr)
