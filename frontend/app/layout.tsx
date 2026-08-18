/** Establishes metadata, Geist typography, theme hydration, and global notifications for the frontend. */

import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import type { ReactNode } from "react";
import { Toaster } from "sonner";

import { ThemeProvider } from "@/components/theme-provider";

import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("http://localhost:8001"),
  title: "Vibe Prompting",
  description: "Edit, inspect, and evaluate durable prompts.",
};

export const viewport: Viewport = {
  maximumScale: 1,
};

const geist = Geist({
  display: "swap",
  subsets: ["latin"],
  variable: "--font-geist",
});

const geistMono = Geist_Mono({
  display: "swap",
  subsets: ["latin"],
  variable: "--font-geist-mono",
});

const THEME_COLOR_SCRIPT =
  "(function(){var h=document.documentElement;var m=document.querySelector('meta[name=theme-color]');if(!m){m=document.createElement('meta');m.name='theme-color';document.head.appendChild(m)}function u(){m.content=h.classList.contains('dark')?'hsl(240 10% 3.9%)':'hsl(0 0% 100%)'}new MutationObserver(u).observe(h,{attributes:true,attributeFilter:['class']});u()})();";

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html className={`${geist.variable} ${geistMono.variable}`} lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_COLOR_SCRIPT }} />
      </head>
      <body className="font-sans antialiased">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          disableTransitionOnChange
          enableSystem
        >
          {children}
          <Toaster position="top-center" richColors />
        </ThemeProvider>
      </body>
    </html>
  );
}
