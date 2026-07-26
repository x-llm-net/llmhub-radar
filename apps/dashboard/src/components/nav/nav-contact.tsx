"use client";

import { Button } from "@openstatus/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@openstatus/ui/components/ui/dialog";
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@openstatus/ui/components/ui/sidebar";
import { Copy, Mail, MessagesSquare } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

const contacts = [
  { key: "qq", value: "570955512" },
  { key: "wechat", value: "keke7u" },
] as const;

export function NavContact() {
  const t = useTranslations("nav");

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(t("contactCopied", { value }));
    } catch {
      toast.error(t("contactCopyFailed"));
    }
  };

  return (
    <SidebarGroup>
      <SidebarGroupLabel>{t("supportCenter")}</SidebarGroupLabel>
      <SidebarMenu>
        <SidebarMenuItem>
          <Dialog>
            <DialogTrigger asChild>
              <SidebarMenuButton
                className="font-commit-mono tracking-tight"
                tooltip={t("contactUs")}
              >
                <MessagesSquare />
                <span>{t("contactUs")}</span>
              </SidebarMenuButton>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>{t("contactUs")}</DialogTitle>
                <DialogDescription>{t("contactDescription")}</DialogDescription>
              </DialogHeader>
              <div className="divide-y rounded-lg border">
                {contacts.map((contact) => (
                  <div
                    key={contact.key}
                    className="flex min-h-14 items-center justify-between gap-4 px-4"
                  >
                    <div className="min-w-0">
                      <p className="text-muted-foreground text-xs">
                        {t(contact.key)}
                      </p>
                      <p className="truncate text-sm font-medium">
                        {contact.value}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => copy(contact.value)}
                      aria-label={t("copyContact", { label: t(contact.key) })}
                      title={t("copyContact", { label: t(contact.key) })}
                    >
                      <Copy className="size-4" />
                    </Button>
                  </div>
                ))}
                <a
                  href="mailto:contact@yunjichuangzhi.cn"
                  className="hover:bg-muted/50 flex min-h-14 items-center justify-between gap-4 px-4 transition-colors"
                >
                  <div className="min-w-0">
                    <p className="text-muted-foreground text-xs">
                      {t("businessEmail")}
                    </p>
                    <p className="truncate text-sm font-medium">
                      contact@yunjichuangzhi.cn
                    </p>
                  </div>
                  <Mail className="text-muted-foreground size-4 shrink-0" />
                </a>
              </div>
            </DialogContent>
          </Dialog>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarGroup>
  );
}
