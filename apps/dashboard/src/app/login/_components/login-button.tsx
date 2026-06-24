"use client";

import { Badge } from "@openstatus/ui/components/ui/badge";
import { Button } from "@openstatus/ui/components/ui/button";
import { cn } from "@openstatus/ui/lib/utils";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

const STORAGE_KEY = "openstatus:last-login-provider";

type Provider = "github" | "google" | "email";

export function LoginButton({
  provider,
  children,
  onClick,
  className,
  ...props
}: {
  provider: Provider;
} & React.ComponentProps<typeof Button>) {
  const [isLastUsed, setIsLastUsed] = useState(false);
  const t = useTranslations("auth");

  useEffect(() => {
    const lastUsed = localStorage.getItem(STORAGE_KEY);
    setIsLastUsed(lastUsed === provider);
  }, [provider]);

  return (
    <Button
      variant="secondary"
      className={cn(
        "relative w-full",
        isLastUsed && "border-primary border",
        className,
      )}
      onClick={(e) => {
        localStorage.setItem(STORAGE_KEY, provider);
        onClick?.(e);
      }}
      {...props}
    >
      {children}
      {isLastUsed ? (
        <Badge
          variant="secondary"
          className="border-primary bg-background absolute -top-2.5 -right-2.5 border text-[10px]"
        >
          {t("lastUsed")}
        </Badge>
      ) : null}
    </Button>
  );
}
