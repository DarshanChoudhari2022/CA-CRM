"use client";

export default function WorkspaceError({ retry }: { retry: () => void }) {
  return (
    <main className="content">
      <section className="card">
        <h1>This page couldn’t load</h1>
        <p>Try loading it again. If the problem continues, contact your administrator.</p>
        <button type="button" className="button button-primary" onClick={retry}>
          Try again
        </button>
      </section>
    </main>
  );
}
