import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "拾光 · 产品情报工作台",
  description: "发现值得研究的产品、商业模式与设计灵感，构建你的个人产品情报工作台。",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">{children}</body>
    </html>
  );
}
