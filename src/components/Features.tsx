import { FEATURES } from '../data/features';

// Renders the typed FEATURES array from src/data. The pattern: keep the data in
// src/data/*.ts, map it to JSX here. Use a stable field (slug) as the key.
function Features() {
  return (
    <section id="features">
      <div className="sechead">
        <span className="slug">/features</span>
        <h2>Patterns to copy</h2>
      </div>
      <div className="cards">
        {FEATURES.map((f) => (
          <article className="card" key={f.slug}>
            <span className="ic">{f.slug}</span>
            <h3>{f.title}</h3>
            <p>{f.body}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

export default Features;
