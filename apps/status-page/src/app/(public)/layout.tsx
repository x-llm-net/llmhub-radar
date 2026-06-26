import { Toaster } from "@openstatus/ui/components/ui/sonner";
import { NextIntlClientProvider } from "next-intl";

import { ThemeProvider } from "@/components/themes/theme-provider";

export default async function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  const locale = "zh";
  const messages = (await import(`../../../messages/${locale}.json`)).default;

  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      <ThemeProvider
        attribute="class"
        defaultTheme="light"
        forcedTheme="light"
        disableTransitionOnChange
      >
        {children}
        <Toaster richColors expand />
      </ThemeProvider>
    </NextIntlClientProvider>
  );
}
