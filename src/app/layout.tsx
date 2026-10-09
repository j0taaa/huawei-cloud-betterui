import type { Metadata } from "next";
import { JetBrains_Mono, Manrope } from "next/font/google";
import { AdaptivePageTitle } from "@/components/adaptive-page-title";
import { TableSearchEnhancer } from "@/components/table-search-enhancer";
import "./globals.css";

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
});

const jetBrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://ui.hwctools.site"),
  title: "Huawei Cloud Better UI",
  description:
    "A faster responsive Huawei Cloud console experience with dashboards for ECS, EVS, VPC, RDS, CCE, OBS, billing, security, databases, networking, storage, and operations.",
  alternates: {
    canonical: "/",
  },
  applicationName: "Huawei Cloud Better UI",
  openGraph: {
    title: "Huawei Cloud Better UI",
    description:
      "A faster responsive Huawei Cloud console experience with infrastructure, security, database, storage, and operations dashboards.",
    url: "/",
    siteName: "Huawei Cloud Better UI",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "Huawei Cloud Better UI",
    description:
      "A faster responsive Huawei Cloud console experience for Huawei Cloud infrastructure and operations.",
  },
  robots: {
    index: true,
    follow: true,
  },
};

const themeScript = `
(() => {
  const key = "better-ui-theme";
  const stored = localStorage.getItem(key);
  const theme = stored === "light" || stored === "dark" || stored === "system" ? stored : "system";
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.classList.toggle("dark", theme === "dark" || (theme === "system" && prefersDark));
  document.documentElement.dataset.theme = theme;
})();
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "Huawei Cloud Better UI",
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    url: "https://ui.hwctools.site",
    description: metadata.description,
  };

  return (
    <html
      lang="en"
      className={`${manrope.variable} ${jetBrainsMono.variable} h-full antialiased`}
      suppressHydrationWarning
      style={{ fontSize: "75%" }}
    >
      <body className="flex min-h-full flex-col font-sans">
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
        />
        {children}
        <AdaptivePageTitle />
        <TableSearchEnhancer />
      </body>
    </html>
  );
}
