"use client";

export default function PortalError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <section className="card">
      <h1>This page is temporarily unavailable</h1>
      <p>Your saved records remain available. Try again, or reload to open the latest version of the portal.</p>
      <div className="ai-actions">
        <button type="button" className="button button-primary" onClick={retry}>
          Try again
        </button>
        <button type="button" className="button button-secondary" onClick={() => window.location.reload()}>
          Reload page
        </button>
      </div>
    </section>
  );
}
