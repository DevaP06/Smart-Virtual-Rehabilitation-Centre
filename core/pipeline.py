"""End-to-end run: load inputs -> train/test split -> profile -> baselines + optimized -> KPIs + validation."""
import numpy as np
import pandas as pd
from .config import CFG
from .data import load_inputs
from .engine import velocity, abc_classes, cooc, partners, assign, naive_assign
from .simulate import kpis
from .validate import validate


def run_all(c=CFG, orders_path=None, regen=False, n_random=5):
    orders, skus, locs = load_inputs(c, orders_path, regen=regen)
    cut = orders.Timestamp.sort_values().iloc[int(len(orders) * c["train_frac"])]
    train, test = orders[orders.Timestamp < cut], orders[orders.Timestamp >= cut]   # layout learns on past, judged on future
    vel = velocity(train)
    pairs = cooc(train, c["max_basket"])
    part = partners(pairs, c["topk"])

    layouts = {"naive (unconstrained)": naive_assign(skus, locs)}
    rand = [assign(skus, locs, vel, part, c, "random", seed=s) for s in range(n_random)]
    layouts["random (feasible)"] = rand[0][0]
    opt, unplaced = assign(skus, locs, vel, part, c, "opt")
    layouts["optimized"] = opt

    res = {}
    for name, a in layouts.items():
        res[name] = {**kpis(test, a, skus, locs, c), **{"violations": validate(a, skus, locs, c)["total"]}}
    rk = pd.DataFrame([kpis(test, a, skus, locs, c) for a, _ in rand])
    return dict(orders=orders, train=train, test=test, skus=skus, locs=locs, vel=vel, abc=abc_classes(vel), pairs=pairs,
                layouts=layouts, results=pd.DataFrame(res).T, random_dist_std=rk.total_distance_m.std(),
                validation={n: validate(a, skus, locs, c) for n, a in layouts.items()}, unplaced=unplaced)
