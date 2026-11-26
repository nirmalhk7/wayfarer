import type { Metadata } from "next";
import "./globals.css";
import { WebVitals } from "./WebVitals";

export const metadata: Metadata = {
  title: "Wayfarer — Trade the city",
  description:
    "Chart nearby starports, chase imperfect market intelligence, and trade your way toward a stronger ship.",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
  openGraph: {
    title: "Wayfarer",
    description: "Trade the city. Chart the unknown.",
    images: [{ url: "/og.jpg", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Wayfarer",
    description: "Trade the city. Chart the unknown.",
    images: ["/og.jpg"],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        {children}
        <WebVitals />
      </body>
    </html>
  );
}
