import { useState } from 'react';

// A tiny interactivity demo: React state works exactly as you'd expect inside
// the immediately.run sandbox. Module-local state, no special wiring.
function Counter() {
  const [count, setCount] = useState(0);

  return (
    <section>
      <div className="sechead">
        <span className="slug">/state</span>
        <h2>It's just React</h2>
      </div>
      <div className="counter">
        <span className="n grad-text">{count}</span>
        <div className="ctrls">
          <button type="button" aria-label="Decrement" onClick={() => setCount((c) => c - 1)}>
            −
          </button>
          <button type="button" aria-label="Increment" onClick={() => setCount((c) => c + 1)}>
            +
          </button>
        </div>
        <p className="hint">
          useState, useEffect, fetch, the DOM — all available. Build your real
          UI the same way. (One exception: <code>localStorage</code> throws at
          the sandbox's opaque origin — see <code>src/hooks/useTheme.ts</code>.)
        </p>
      </div>
    </section>
  );
}

export default Counter;
