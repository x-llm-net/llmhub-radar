import { cn } from "@openstatus/ui/lib/utils";
import type { Metadata } from "next";

import "./globals.css";
import LocalFont from "next/font/local";
import { NuqsAdapter } from "nuqs/adapters/next/app";

import { TailwindIndicator } from "@/components/tailwind-indicator";
import { TRPCReactProvider } from "@/lib/trpc/client";

import { ogMetadata, twitterMetadata } from "./metadata";
import { defaultMetadata } from "./metadata";

const cal = LocalFont({
  src: "../../public/fonts/CalSans-SemiBold.ttf",
  variable: "--font-cal-sans",
});

const commitMono = LocalFont({
  src: [
    {
      path: "../../public/fonts/CommitMono-400-Regular.otf",
      weight: "400",
      style: "normal",
    },
    {
      path: "../../public/fonts/CommitMono-400-Italic.otf",
      weight: "400",
      style: "italic",
    },
    {
      path: "../../public/fonts/CommitMono-700-Regular.otf",
      weight: "700",
      style: "normal",
    },
    {
      path: "../../public/fonts/CommitMono-700-Italic.otf",
      weight: "700",
      style: "italic",
    },
  ],
  variable: "--font-commit-mono",
});

export const metadata: Metadata = {
  ...defaultMetadata,
  twitter: {
    ...twitterMetadata,
  },
  openGraph: {
    ...ogMetadata,
  },
};

// export const dynamic = "error";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={cn(
          cal.variable,
          commitMono.variable,
          "font-sans antialiased",
        )}
      >
        <NuqsAdapter>
          <TRPCReactProvider>
            {children}
            <TailwindIndicator />
          </TRPCReactProvider>
        </NuqsAdapter>
      </body>
    </html>
  );
}
