import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    // Android uses this value on its installed-app splash screen. Newlines
    // intentionally keep the project name and its purpose readable on phones.
    name: "NEXUS RESCUE\nแพลตฟอร์มประสานงานกู้ภัย\nและติดตามช่วยเหลือผู้ประสบภัย",
    short_name: "NEXUS RESCUE",
    description: "แพลตฟอร์มประสานงานกู้ภัยและติดตามช่วยเหลือผู้ประสบภัย",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#F9FBFE",
    theme_color: "#002855",
    lang: "th",
    icons: [
      {
        src: "/brand-logo.png",
        sizes: "2000x2000",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/brand-logo.png",
        sizes: "2000x2000",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
