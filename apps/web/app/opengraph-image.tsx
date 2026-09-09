import { ImageResponse } from "next/og";

export const alt = "foryour.fans — a Bluesky-native paid creator network";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * Default OpenGraph / Twitter card image for every route. Deliberately
 * text-only and brand-controlled: no user content and no NSFW imagery ever
 * appears in a preview asset (requirement #5).
 */
export default function OgImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "80px",
          background: "linear-gradient(135deg, #0b0b12 0%, #1c1636 55%, #3b2a7a 100%)",
          color: "#fafafa",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", fontSize: 68, fontWeight: 700, letterSpacing: "-0.02em" }}>
          <span>foryour</span>
          <span style={{ color: "#a78bfa" }}>.fans</span>
        </div>
        <div style={{ marginTop: 24, fontSize: 34, lineHeight: 1.3, color: "#c9c9d4", maxWidth: 900 }}>
          A paid creator network on Bluesky's AT Protocol. Portable identity, subscriber-only
          content, leave any time without losing your audience.
        </div>
      </div>
    ),
    size,
  );
}
