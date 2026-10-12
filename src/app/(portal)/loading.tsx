export default function PortalLoading() {
  return (
    <section className="loading-shell" aria-busy="true" aria-label="Loading workspace">
      <p role="status">Loading workspace…</p>
      <div className="skeleton skeleton-title" />
      <div className="grid grid-3">
        {[1, 2, 3].map((id) => (
          <div className="card skeleton skeleton-card" key={id} />
        ))}
      </div>
      <div className="card skeleton skeleton-panel" />
    </section>
  );
}
