// DOM wrapper around the 3D warehouse: lazy-loads the scene, falls back if it cannot start, hosts the projected labels and the bin-detail card.
// `fixed` = the page-long backdrop on desktop; otherwise it fills its parent (the hero card on tablet / phone).
import { Component, Suspense, lazy, useRef, useState } from "react";
import { X } from "lucide-react";
import { LABELS } from "./stageLabels.js";

const StageScene = lazy(() => import("./StageScene.jsx"));

class Boundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.onFail?.();
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export default function Stage({ fixed, fallback, onSettled, onFail, skipIntro = false }) {
  const els = useRef(new Map()).current;
  const [info, setInfo] = useState(null);
  const intro = useRef(!skipIntro); // the entrance plays once per visit; a theme change remounts the canvas without replaying it
  const settled = () => {
    intro.current = false;
    onSettled?.();
  };
  return (
    <div className={`lw-stage ${fixed ? "lw-fixed" : "lw-inline"}`}>
      <div className="lw-canvas">
        <Boundary fallback={fallback} onFail={onFail}>
          <Suspense fallback={fallback}>
            <StageScene labelEls={els} intro={intro.current} onSettled={settled} onInfo={setInfo} />
          </Suspense>
        </Boundary>
      </div>
      <div className="lw-labels" aria-hidden="true">
        {LABELS.map((l) => (
          <span key={l.id} ref={(el) => (el ? els.set(l.id, el) : els.delete(l.id))} className={`lw-label ${l.tone || ""}`} style={{ opacity: 0 }}>
            {l.text}
          </span>
        ))}
      </div>
      {info && (
        <div className="hero-info" role="status">
          <button type="button" className="icon-btn small" onClick={() => setInfo(null)} aria-label="Close bin details">
            <X size={14} aria-hidden="true" />
          </button>
          <b className="mono">{info.loc}</b>
          {info.sku ? (
            <>
              <span>
                {info.sku} · demand class {info.cls}
              </span>
              <span>
                Demand index {info.demand} (illustrative){info.inOrder ? " · on the demo order" : ""}
              </span>
            </>
          ) : (
            <span>Stocked bin (illustrative, no product data)</span>
          )}
        </div>
      )}
      <span className="lw-tag l-tag">Illustrative warehouse model</span>
    </div>
  );
}
