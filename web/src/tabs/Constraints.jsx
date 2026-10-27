import { Async, LABEL, Note, RULE_LABEL, useApi } from "../ui.jsx";

const SHOW = ["naive", "B0_random", "B2_abc", "B3_golden", "B4_affinity", "Full", "Full+CPSAT", "Full+CPSAT+LS"];

export default function Constraints({ run }) {
  const st = useApi(`/api/runs/${run.id}/violations`);
  return (
    <Async state={st}>
      {(v) => (
        <>
          <div className="panel">
            <h2>Independent validator: violations by rule</h2>
            <p style={{ color: "var(--muted)" }}>
              The validator shares no code with the optimizer. It re-derives every rule from the raw SKU and location tables and counts breaches. The target
              for every compliant layout is zero.
            </p>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Rule</th>
                    {SHOW.map((p) => (
                      <th key={p}>{LABEL[p]}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {Object.keys(RULE_LABEL).map((r) => (
                    <tr key={r} style={r === "total" ? { fontWeight: 700 } : null}>
                      <td>{RULE_LABEL[r]}</td>
                      {SHOW.map((p) => (
                        <td key={p} className={v[p]?.[r] ? "nonzero" : "zero"}>
                          {v[p]?.[r] ?? 0}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <Note>
            Rules enforced: bin dimensions (any axis rotation), volume, bin weight, shelf-beam and rack-frame load, hazard cage, flammable and oxidizer never in the
            same or an adjacent bay, fragile on levels 2 to 4, heavy items on levels 1 and 2. The naive layout ignores all of them.
          </Note>
        </>
      )}
    </Async>
  );
}
