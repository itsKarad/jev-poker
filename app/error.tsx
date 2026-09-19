"use client";

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="centered-message">
      <p className="eyebrow">Something went wrong</p>
      <h1>The table could not load.</h1>
      <button className="button primary" onClick={reset}>Try again</button>
    </main>
  );
}
