import { Boxes, Footprints, Scale, ShieldAlert } from "lucide-react";
import Plan from "../Plan.jsx";
import { Illustrative, Section, useStage } from "../parts.jsx";
import { useEased, useInView } from "../hooks.js";
import { ITEMS, ORDER_IDS, itemXZ, routePoints } from "../sceneData.js";

const COSTS = [
  [Footprints, "Excessive picking distance", "Fast movers stored deep in an aisle send every picker the long way, order after order."],
  [Boxes, "Poor space utilization", "Products in bins that are far too large leave volume empty while others run out of room."],
  [Scale, "Physical storage limits", "Weight per shelf beam, rack frame load and bin dimensions are hard limits, not preferences."],
  [ShieldAlert, "Incompatible or unsafe neighbours", "Hazard classes, fragile goods and heavy items each restrict where a product may sit."],
];

export default function ProblemSection() {
  const stage = useStage();
  const [ref, seen] = useInView(0.35);
  const draw = useEased(seen, 1800);
  const items = ITEMS.map((it) => {
    const [x, z] = itemXZ(it, "base");
    return { id: it.id, cls: it.cls, x, z, hot: ORDER_IDS.includes(it.id), dim: !ORDER_IDS.includes(it.id) };
  });
  return (
    <Section id="problem" n="01" eyebrow="The operational problem" title="Every inefficient placement has a cost." lead="A picker's walk is decided long before the order arrives: by where each product was put away.">
      <div className="l-split">
        <ul className="l-costs">
          {COSTS.map(([Icon, t, d]) => (
            <li key={t}>
              <Icon size={20} aria-hidden="true" />
              <div>
                <h3>{t}</h3>
                <p>{d}</p>
              </div>
            </li>
          ))}
        </ul>
        {!stage && (
        <figure className="l-figure" ref={ref}>
          <Plan
            label="Top-down plan of an illustrative warehouse. A picker's route to five products zig-zags between three aisles and runs deep into each of them."
            items={items}
            routes={[{ pts: routePoints("base"), tone: "base", draw }]}
            notes={[
              { x: 0.2, z: 9.9, text: "fast movers stored deep", opacity: draw > 0.55 ? 1 : 0 },
              { x: 17, z: 1.5, text: "back and forth between aisles", anchor: "end", opacity: draw > 0.9 ? 1 : 0 },
            ]}
          />
          <figcaption>
            <Illustrative /> One customer order of five products (highlighted) picked from a baseline layout.
          </figcaption>
        </figure>
        )}
      </div>
    </Section>
  );
}
