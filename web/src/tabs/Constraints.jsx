import { CheckCircle2, ListChecks, ShieldAlert, ShieldCheck, XCircle } from "lucide-react";
import { Async, Card, InfoTip, LABEL, Note, Panel, RULE_LABEL, TableScroll, useApi } from "../ui.jsx";

const SHOW = ["naive", "B0_random", "B2_abc", "B3_golden", "B4_affinity", "Full", "Full+CPSAT", "Full+CPSAT+LS"];

// Plain-language meaning of each rule counter (from how the validator checks them).
const RULE_HELP = {
  unplaced_skus: "Products that the layout did not assign to any bin.",
  double_booked_bins: "Bins that were assigned more than one product.",
  dimension_overflow: "The product does not fit the bin in any orientation.",
  volume_overflow: "Stored volume (case volume × cases) is larger than the bin.",
  bin_overweight: "Stored weight is above the bin's weight rating.",
  beam_overload: "Total weight on a shelf beam is above its rating.",
  frame_overload: "Total weight in a rack frame is above its rating.",
  hazard_zone_breach: "A hazardous product is outside the hazard cage, or an ordinary product is inside it.",
  fragile_bad_level: "A fragile product is not on shelf levels 2 to 4.",
  heavy_too_high: "A heavy product is above shelf level 2.",
  incompatible_adjacent: "A flammable product shares a bay, or an adjacent bay, with an oxidizer.",
  total: "Sum of all rule breaches for the layout.",
};

export default function Constraints({ run }) {
  const st = useApi(`/api/runs/${run.id}/violations`);
  return (
    <Async state={st} skeleton="page" label="the rule checks">
      {(v) => {
        const clean = SHOW.filter((p) => (v[p]?.total ?? 0) === 0).length;
        const ruleKeys = Object.keys(RULE_LABEL).filter((r) => r !== "total");
        return (
          <div className="stack">
            <div className="kpi-grid">
              <Card icon={ListChecks} label="Rules checked" value={ruleKeys.length} sub="Size, weight, hazard, shelf level and neighbours" />
              <Card icon={ShieldCheck} tone={clean > 0 ? "good" : ""} label="Layouts with zero violations" value={`${clean} of ${SHOW.length}`} sub="Every compliant layout must score zero" />
              <Card
                icon={ShieldAlert}
                tone={(v.naive?.total ?? 0) > 0 ? "warn" : ""}
                label="Naive layout violations"
                value={(v.naive?.total ?? 0).toLocaleString()}
                sub="The naive layout ignores every rule, to show why they matter"
              />
            </div>

            <Panel
              title="Independent validator: violations by rule"
              subtitle="The validator shares no code with the optimizer. It re-derives every rule from the raw SKU and location tables and counts breaches. The target for every compliant layout is zero."
              icon={ShieldCheck}
            >
              <TableScroll label="Violations by rule and layout">
                <table className="data">
                  <caption className="sr-only">Rows are rules, columns are layouts. Each cell is the number of breaches; ✓ means none and ✕ means at least one.</caption>
                  <thead>
                    <tr>
                      <th scope="col">Rule</th>
                      {SHOW.map((p) => (
                        <th scope="col" key={p}>
                          {LABEL[p]}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {Object.keys(RULE_LABEL).map((r) => (
                      <tr key={r} className={r === "total" ? "total" : ""}>
                        <td>
                          <span className="th-in">
                            {RULE_LABEL[r]}
                            <InfoTip text={RULE_HELP[r]} />
                          </span>
                        </td>
                        {SHOW.map((p) => {
                          const n = v[p]?.[r] ?? 0;
                          return (
                            <td key={p} className={n ? "nonzero" : "zero"}>
                              <span className="cell-flag">
                                {n ? <XCircle size={14} aria-hidden="true" /> : <CheckCircle2 size={14} aria-hidden="true" />}
                                <span className="sr-only">{n ? "violations: " : "no violations: "}</span>
                                {n.toLocaleString()}
                              </span>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableScroll>
            </Panel>

            <Panel title="What each rule means" icon={ListChecks}>
              <div className="rules-grid">
                {ruleKeys.map((r) => (
                  <div className="rule" key={r}>
                    <b>{RULE_LABEL[r]}</b>
                    {RULE_HELP[r]}
                  </div>
                ))}
              </div>
            </Panel>

            <Note>
              Rules enforced: bin dimensions (any axis rotation), volume, bin weight, shelf-beam and rack-frame load, hazard cage, flammable and oxidizer never in the same or an adjacent bay, fragile on levels 2 to 4, heavy items
              on levels 1 and 2. The naive layout ignores all of them.
            </Note>
          </div>
        );
      }}
    </Async>
  );
}
