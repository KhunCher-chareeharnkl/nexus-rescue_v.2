import { ImageResponse } from "next/og";

export const size = { width: 512, height: 512 };
export const contentType = "image/png";

export default function Icon() {
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
          border: "28px solid #DCEAF7",
          borderRadius: 104,
          color: "white",
          fontFamily: "Arial, sans-serif",
          fontWeight: 800,
          fontSize: 232,
          letterSpacing: -18,
        }}
      >
        N
      </div>
    ),
    size,
  );
}
