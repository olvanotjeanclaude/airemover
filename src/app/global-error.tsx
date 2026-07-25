"use client";

import { useEffect } from "react";

/**
 * Last-resort boundary: it replaces the root layout, so it cannot use the app's
 * providers or components and has to carry its own markup and styles.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // No telemetry: the message goes to the user's own console and nowhere else.
    console.error("Image Metadata Cleaner crashed:", error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "2rem",
          background: "#ffffff",
          color: "#1a1c23",
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
        }}
      >
        <main style={{ maxWidth: "34rem", textAlign: "center" }}>
          <h1 style={{ fontSize: "1.75rem", fontWeight: 600, letterSpacing: "-0.02em" }}>
            Something went wrong
          </h1>
          <p style={{ marginTop: "0.75rem", lineHeight: 1.6, color: "#5b6070" }}>
            The app hit an unexpected error. Your images were never uploaded, and nothing was
            saved, so reloading is completely safe.
          </p>
          {error.digest ? (
            <p style={{ marginTop: "0.5rem", fontSize: "0.8rem", color: "#8b8f9e" }}>
              Reference: {error.digest}
            </p>
          ) : null}
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: "1.5rem",
              padding: "0.625rem 1.25rem",
              borderRadius: "0.625rem",
              border: "none",
              background: "#4f46e5",
              color: "#ffffff",
              fontSize: "0.9rem",
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
