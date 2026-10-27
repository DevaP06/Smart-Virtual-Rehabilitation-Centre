# All tunables live here so judges can change the warehouse and rerun. Units: cm, kg, litres, metres, seconds.
CFG = dict(
    seed=7,
    # warehouse grid
    aisles=10, bays=20, bins=2, haz_aisles=(9,), aisle_pitch=4.0, bay_pitch=1.2, y0=3.0,
    level_z=[20, 70, 120, 170, 220],             # shelf heights in cm; levels 3-4 are the golden zone
    bin_cap=[100, 70, 50, 35, 25],               # max kg per bin, by level
    beam_cap=[150, 100, 70, 50, 35],             # max kg per shelf beam (both bins of a level), by level
    frame_cap=300,                               # max kg per rack frame (all levels)
    bin_dims={"L": (80, 50, 60), "M": (60, 40, 40), "S": (40, 30, 30)},
    level_bins=[("L", "L"), ("M", "L"), ("M", "M"), ("S", "M"), ("M", "S")],
    # demand data
    n_sku=1500, n_orders=20000, max_basket=30, train_frac=0.8, topk=15,
    # business rules
    heavy_kg=15, fragile_levels=(2, 4), heavy_max_level=2,
    # objective weights
    erg_pen=[8, 4, 0, 0, 10],                    # ergonomic penalty in "metre-equivalents" by level
    lam_aff=1.5,                                 # weight of the affinity (pick together) term
    v_floor=1.0,                                 # baseline pull toward the depot, as a fraction of mean SKU velocity
    mu_fill=0.5,                               # weight of the wasted-volume (best-fit) term
    # simulation
    speed=1.2, pick_s=10, level_sec=[6, 3, 0, 0, 6],
)
