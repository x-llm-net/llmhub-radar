"use client";

import { Input } from "@openstatus/ui/components/ui/input";
import { Label } from "@openstatus/ui/components/ui/label";
import { useLocale, useTranslations } from "next-intl";
import { useFormStatus } from "react-dom";
import { toast } from "sonner";

import { signInWithResendAction } from "./actions";
import { LoginButton } from "./login-button";

function SubmitButton() {
  const { pending } = useFormStatus();
  const t = useTranslations("auth");

  return (
    <LoginButton provider="email" type="submit" disabled={pending}>
      {pending ? t("magicLinkLoading") : t("magicLink")}
    </LoginButton>
  );
}

export default function MagicLinkForm({ redirectTo }: { redirectTo?: string }) {
  const t = useTranslations("auth");
  const locale = useLocale();

  return (
    <form
      action={async (formData) => {
        try {
          await signInWithResendAction(formData);
          toast.success(t("magicLinkSuccess"));
        } catch (e) {
          console.error(e);
          toast.error(t("magicLinkError"));
        }
      }}
      className="grid gap-3"
    >
      <input type="hidden" name="redirectTo" value={redirectTo ?? "/radar"} />
      <input type="hidden" name="locale" value={locale} />
      <div className="grid gap-1.5">
        <Label htmlFor="email">{t("email")}</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder={t("emailPlaceholder")}
          required
        />
      </div>
      <SubmitButton />
      <p className="text-muted-foreground text-xs leading-relaxed">
        {t("magicLinkHelp")}
      </p>
    </form>
  );
}
