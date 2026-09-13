import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Nexus Rescue | ระบบประสานงานกู้ภัย",
    short_name: "Nexus Rescue",
    description: "แพลตฟอร์มประสานงานกู้ภัยและติดตามความช่วยเหลือผู้ประสบภัย",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#F9FBFE",
    theme_color: "#002855",
    lang: "th",
    icons: [
      {
        src: "/icon",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
