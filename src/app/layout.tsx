import type { Metadata } from "next";
import { Inter, Onest } from "next/font/google";
import "./globals.css";
import { ToastProvider } from "@/components/toast";
import { UploadProvider } from "@/components/upload-context";

const inter = Inter({ subsets: ["latin"], variable: '--font-inter' });
const onest = Onest({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: '--font-caslon',
});

export const metadata: Metadata = {
  title: {
    default: "doto — Your Voice",
    template: "%s · doto",
  },
  description: "Your brain, quantified via AI.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${inter.variable} ${onest.variable} font-sans antialiased`}
      >
        <ToastProvider>
          <UploadProvider>
            {children}
          </UploadProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
