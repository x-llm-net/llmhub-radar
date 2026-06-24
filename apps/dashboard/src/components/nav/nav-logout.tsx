"use client";

import { Button } from "@openstatus/ui/components/ui/button";
import { LogOut } from "lucide-react";
import { signOut } from "next-auth/react";
import { useTranslations } from "next-intl";

export function NavLogout({
  onClick,
  ...props
}: Omit<React.ComponentProps<typeof Button>, "children">) {
  const t = useTranslations("nav");

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) signOut();
      }}
      {...props}
    >
      <LogOut className="size-3" />
      {t("logOut")}
    </Button>
  );
}
