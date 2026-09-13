import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#002855",
          border: "10px solid #DCEAF7",
          borderRadius: 38,
          color: "white",
          fontFamily: "Arial, sans-serif",
          fontWeight: 800,
          fontSize: 82,
          letterSpacing: -7,
        }}
      >
        N
      </div>
    ),
    size,
  );
}
