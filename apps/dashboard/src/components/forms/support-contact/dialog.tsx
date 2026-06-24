import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@openstatus/ui/components/ui/dialog";
import { useIsMobile } from "@openstatus/ui/hooks/use-mobile";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Link } from "@/components/common/link";
import { useTRPC } from "@/lib/trpc/client";

import { ContactForm, type FormValues } from "./form";

export function FormDialogSupportContact({
  children,
  defaultValues,
  ...props
}: React.ComponentProps<typeof DialogTrigger> & {
  defaultValues?: FormValues;
}) {
  const [open, setOpen] = useState(false);
  const isMobile = useIsMobile();
  const trpc = useTRPC();
  const { data: user } = useQuery(trpc.user.get.queryOptions());
  const feedbackMutation = useMutation(trpc.feedback.submit.mutationOptions());
  const t = useTranslations("supportContact");

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger {...props} asChild>
        {children}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>
            {t("descriptionPrefix")}{" "}
            <Link href="mailto:ping@openstatus.dev">ping@openstatus.dev</Link>.
          </DialogDescription>
        </DialogHeader>
        <ContactForm
          defaultValues={{
            name: defaultValues?.name ?? user?.name ?? undefined,
            email: defaultValues?.email ?? user?.email ?? undefined,
            type: defaultValues?.type,
            message: defaultValues?.message,
            blocker: defaultValues?.blocker,
          }}
          onSubmit={async (data) => {
            await feedbackMutation.mutateAsync({
              source: "support",
              name: data.name,
              email: data.email,
              type: data.type,
              message: data.message,
              blocker: data.blocker,
              path: window.location.pathname,
              isMobile,
            });
            setOpen(false);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
