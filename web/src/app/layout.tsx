import type { Metadata, Viewport } from "next";
import Script from "next/script";
import "./globals.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Lift Log · 随时开练",
  description: "按当前力量和恢复状态调整的私人训练日志",
  robots: { index: false, follow: false },
  appleWebApp: { capable: true, title: "Lift Log", statusBarStyle: "black-translucent" },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#101914" };
export default function Layout({ children }: { children: React.ReactNode }) {
  const src = process.env.NEXT_PUBLIC_UMAMI_SRC;
  const id = process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID;
  return <html lang="zh-CN"><body>
    {children}
    {src && id ? <Script src={src} data-website-id={id} strategy="afterInteractive" /> : null}
  </body></html>;
}
