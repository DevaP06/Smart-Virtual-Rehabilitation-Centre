import { createContext, useContext } from "react";
import { Shapes } from "lucide-react";
import { useInView } from "./hooks.js";

/** True when the fixed 3D warehouse is the page backdrop (desktop). Sections then drop their own figures and drive the 3D scene instead. */
export const StageCtx = createContext(false);
export const useStage = () => useContext(StageCtx);

/** Section frame: scroll-reveals once, carries the id used by the header links. */
export function Section({ id, n, eyebrow, title, lead, children, tone = "" }) {
  const [ref, seen] = useInView(0.12);
  return (
    <section id={id} ref={ref} className={`l-section ${tone} reveal${seen ? " in" : ""}`} aria-labelledby={`${id}-h`}>
      <div className="l-wrap">
        <header className="l-section-head">
          {eyebrow && (
            <p className="l-eyebrow">
              {n && <span className="l-num">{n}</span>}
              {eyebrow}
            </p>
          )}
          <h2 id={`${id}-h`}>{title}</h2>
          {lead && <p className="l-lead">{lead}</p>}
        </header>
        {children}
      </div>
    </section>
  );
}

/** Marks a visual as a hand-made example rather than measured data. */
export function Illustrative({ children = "Illustrative example, not measured data" }) {
  return (
    <span className="l-tag">
      <Shapes size={13} aria-hidden="true" /> {children}
    </span>
  );
}
