"use client";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@openstatus/ui/components/ui/alert-dialog";
import { Button } from "@openstatus/ui/components/ui/button";
import { Input } from "@openstatus/ui/components/ui/input";
import { useCopyToClipboard } from "@openstatus/ui/hooks/use-copy-to-clipboard";
import { isTRPCClientError } from "@trpc/client";
import { Check, Copy } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";

interface FormAlertDialogProps {
  confirmationValue: string;
  submitAction: () => Promise<void>;
  children?: React.ReactNode;
}

export function FormAlertDialog({
  confirmationValue,
  submitAction,
  children,
}: FormAlertDialogProps) {
  const [value, setValue] = useState("");
  const [isPending, startTransition] = useTransition();
  const { copy, isCopied } = useCopyToClipboard();
  const [open, setOpen] = useState(false);
  const commonT = useTranslations("common");
  const t = useTranslations("quickActions");

  const handleDelete = async () => {
    try {
      startTransition(async () => {
        const promise = submitAction();
        toast.promise(promise, {
          loading: commonT("deleting"),
          success: commonT("deleted"),
          error: (error) => {
            if (isTRPCClientError(error)) {
              return error.message;
            }
            return commonT("failedToDelete");
          },
        });
        await promise;
        setOpen(false);
      });
    } catch (error) {
      console.error("Failed to revoke:", error);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        {children ?? (
          <Button variant="destructive" size="sm">
            {commonT("delete")}
          </Button>
        )}
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t("deleteTitle", { value: confirmationValue })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t("deleteDescription")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <form id="form-alert-dialog" className="space-y-1.5">
          <p className="text-muted-foreground text-sm">
            {t("typeToConfirmPrefix")}{" "}
            <Button
              variant="secondary"
              size="sm"
              type="button"
              className="font-normal [&_svg]:size-3"
              onClick={() => copy(confirmationValue, { withToast: false })}
            >
              {confirmationValue}
              {isCopied ? <Check /> : <Copy />}
            </Button>{" "}
            {t("typeToConfirmSuffix")}
          </p>
          <Input value={value} onChange={(e) => setValue(e.target.value)} />
        </form>
        <AlertDialogFooter>
          <AlertDialogCancel>{commonT("cancel")}</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:bg-destructive/60 dark:focus-visible:ring-destructive/40 text-white shadow-xs"
            disabled={value !== confirmationValue || isPending}
            form="form-alert-dialog"
            type="submit"
            onClick={(e) => {
              e.preventDefault();
              handleDelete();
            }}
          >
            {isPending ? commonT("deleting") : commonT("delete")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
