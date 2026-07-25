import { ImageResponse } from "next/og";
import { SITE } from "@/constants/site";

export const alt = `${SITE.name} — ${SITE.tagline}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const CHIPS = ["EXIF", "GPS", "XMP", "IPTC", "C2PA", "AI data"];

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "72px",
          background: "linear-gradient(135deg, #12141c 0%, #1b1f36 55%, #241d4a 100%)",
          color: "#f5f6fa",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "18px" }}>
          <div
            style={{
              display: "flex",
              width: "56px",
              height: "56px",
              borderRadius: "16px",
              background: "linear-gradient(140deg, #4e58e8, #7c4ce2)",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "30px",
            }}
          >
            {String.fromCodePoint(0x1f6e1)}
          </div>
          <div style={{ display: "flex", fontSize: "28px", fontWeight: 600, letterSpacing: "-0.5px" }}>
            {SITE.name}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
          <div
            style={{
              display: "flex",
              fontSize: "78px",
              fontWeight: 700,
              lineHeight: 1.05,
              letterSpacing: "-2.5px",
              maxWidth: "940px",
            }}
          >
            Remove Image Metadata Instantly
          </div>
          <div
            style={{
              display: "flex",
              fontSize: "31px",
              color: "#aab0c8",
              maxWidth: "900px",
              lineHeight: 1.35,
            }}
          >
            EXIF, GPS, XMP, AI metadata and C2PA, stripped entirely inside your browser.
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", gap: "12px" }}>
            {CHIPS.map((chip) => (
              <div
                key={chip}
                style={{
                  display: "flex",
                  padding: "10px 20px",
                  borderRadius: "999px",
                  border: "1px solid #3a3f5c",
                  background: "#1c2033",
                  fontSize: "24px",
                  color: "#c9cde0",
                }}
              >
                {chip}
              </div>
            ))}
          </div>
          <div style={{ display: "flex", fontSize: "26px", fontWeight: 600, color: "#8ee0a8" }}>
            No uploads
          </div>
        </div>
      </div>
    ),
    size,
  );
}
