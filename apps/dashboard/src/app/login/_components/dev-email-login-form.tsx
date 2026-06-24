"use client";

import { Input } from "@openstatus/ui/components/ui/input";
import { Label } from "@openstatus/ui/components/ui/label";
import { useTranslations } from "next-intl";
import { useFormStatus } from "react-dom";

import { signInWithDevEmailAction } from "./actions";
import { LoginButton } from "./login-button";

function SubmitButton() {
  const { pending } = useFormStatus();
  const t = useTranslations("auth");

  return (
    <LoginButton provider="email" type="submit" disabled={pending}>
      {pending ? t("signingIn") : t("continueLocal")}
    </LoginButton>
  );
}

export function DevEmailLoginForm({ redirectTo }: { redirectTo?: string }) {
  const t = useTranslations("auth");

  return (
    <form action={signInWithDevEmailAction} className="grid gap-2">
      <input type="hidden" name="redirectTo" value={redirectTo ?? "/radar"} />
      <div className="grid gap-1.5">
        <Label htmlFor="dev-email">{t("email")}</Label>
        <Input
          id="dev-email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder={t("emailPlaceholder")}
          required
        />
      </div>
      <SubmitButton />
    </form>
  );
}
