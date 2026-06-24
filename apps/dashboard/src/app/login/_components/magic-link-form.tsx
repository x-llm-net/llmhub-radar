"use client";

import { Input } from "@openstatus/ui/components/ui/input";
import { Label } from "@openstatus/ui/components/ui/label";
import { useTranslations } from "next-intl";
import { useFormStatus } from "react-dom";
import { toast } from "sonner";

import { signInWithResendAction } from "./actions";
import { LoginButton } from "./login-button";

/**
 * @deprecated - only to be used in development mode
 */
export default function MagicLinkForm() {
  const { pending } = useFormStatus();
  const t = useTranslations("auth");

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
      className="grid gap-2"
    >
      <div className="grid gap-1.5">
        <Label htmlFor="email">{t("email")}</Label>
        <Input id="email" name="email" type="email" required />
      </div>
      <LoginButton provider="email">
        {pending ? t("magicLinkLoading") : t("magicLink")}
      </LoginButton>
    </form>
  );
}
