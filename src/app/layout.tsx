import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Inter, Anton, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const anton = Anton({ weight: "400", subsets: ["latin"], variable: "--font-anton" });
const jbmono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jbmono" });

export const metadata: Metadata = {
  title: "UNOshima",
  description: "Classic, No Mercy, Flip, Flex and All Wild with friends or bots.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0a0a0c",
};

const themeInit = `try{var t=localStorage.getItem('uno-theme');if(!t)t='dark';document.documentElement.dataset.theme=t;}catch(e){document.documentElement.dataset.theme='dark';}`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-theme="dark" className={`${inter.variable} ${anton.variable} ${jbmono.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
