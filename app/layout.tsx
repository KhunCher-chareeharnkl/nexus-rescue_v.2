import type { Metadata, Viewport } from "next";
import { PwaRegister } from "@/components/pwa-register";
import { PROJECT_NAME } from "@/lib/brand";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: PROJECT_NAME,
    template: `%s | ${PROJECT_NAME}`,
  },
  description: PROJECT_NAME,
};

export const viewport: Viewport = {
  themeColor: "#002855",
  colorScheme: "light",
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="th" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        {children}
        <PwaRegister />
      </body>
    </html>
  );
}
