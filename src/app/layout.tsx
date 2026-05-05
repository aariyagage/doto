import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { Analytics } from "@vercel/analytics/react";
import "./globals.css";
import { ToastProvider } from "@/components/toast";
import { UploadProvider } from "@/components/upload-context";

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "doto · turn thoughts into content",
    template: "%s · doto",
  },
  description: "doto helps creators shape rough thoughts, half-ideas, and old videos into actual content they can post.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${inter.variable} font-sans antialiased`}>
        <ToastProvider>
          <UploadProvider>
            {children}
          </UploadProvider>
        </ToastProvider>
        {/* Vercel Web Analytics. No-op until enabled in the project's
            Vercel dashboard (Settings → Analytics → Enable). Free Hobby
            tier covers 2.5k events/month, which is plenty for solo use. */}
        <Analytics />
      </body>
    </html>
  );
}
