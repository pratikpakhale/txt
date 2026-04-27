import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ThemeProvider } from "next-themes";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const siteUrl = "https://txt.pakhale.com";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "txt — encrypted notes",
  description:
    "End-to-end encrypted notepad. AES-256-GCM, client-side only. Your password is your key.",
  applicationName: "txt",
  alternates: {
    canonical: siteUrl,
  },
  icons: {
    icon: "/favicon.svg",
  },
  openGraph: {
    type: "website",
    url: siteUrl,
    siteName: "txt",
    title: "txt — encrypted notes",
    description:
      "End-to-end encrypted notepad. AES-256-GCM, client-side only. Your password is your key.",
    images: [
      {
        url: "/og-image.svg",
        width: 1200,
        height: 630,
        alt: "txt — encrypted notes",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "txt — encrypted notes",
    description:
      "End-to-end encrypted notepad. AES-256-GCM, client-side only. Your password is your key.",
    images: ["/og-image.svg"],
  },
  robots: {
    index: true,
    follow: true,
  },
};

export const viewport: Viewport = {
  themeColor: "#080808",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
