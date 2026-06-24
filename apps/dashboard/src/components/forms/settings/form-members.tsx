"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@openstatus/ui/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@openstatus/ui/components/ui/form";
import { Input } from "@openstatus/ui/components/ui/input";
import {
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@openstatus/ui/components/ui/tabs";
import { Tabs } from "@openstatus/ui/components/ui/tabs";
import { Lock } from "lucide-react";
import { useTranslations } from "next-intl";
import { useTransition } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { Link } from "@/components/common/link";
import { DataTable as InvitationsDataTable } from "@/components/data-table/settings/invitations/data-table";
import { DataTable as MembersDataTable } from "@/components/data-table/settings/members/data-table";
import {
  FormCardContent,
  FormCardDescription,
  FormCardHeader,
  FormCardSeparator,
  FormCardTitle,
  FormCardUpgrade,
} from "@/components/forms/form-card";
import { FormCard } from "@/components/forms/form-card";

import { FormCardFooter, FormCardFooterInfo } from "../form-card";

const schema = z.object({
  email: z.email(),
  role: z.enum(["member"]),
});

type FormValues = z.infer<typeof schema>;

export function FormMembers({
  locked,
  onCreate,
}: {
  locked?: boolean;
  onCreate: (values: FormValues) => Promise<void>;
}) {
  const t = useTranslations("settings.forms");
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      email: "",
      role: "member",
    },
  });
  const [isPending, startTransition] = useTransition();

  function submitAction(values: FormValues) {
    if (isPending) return;

    startTransition(async () => {
      try {
        const promise = onCreate(values);
        toast.promise(promise, {
          loading: t("saving"),
          success: () => t("saved"),
          error: t("failedToSave"),
        });
        await promise;
        form.reset();
      } catch (error) {
        console.error(error);
      }
    });
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(submitAction)}>
        <FormCard>
          {locked ? <FormCardUpgrade /> : null}
          <FormCardHeader>
            <FormCardTitle>{t("team")}</FormCardTitle>
            <FormCardDescription>{t("teamDescription")}</FormCardDescription>
          </FormCardHeader>
          <FormCardContent>
            <Tabs defaultValue="members">
              <TabsList>
                <TabsTrigger value="members">{t("members")}</TabsTrigger>
                <TabsTrigger value="pending">{t("pending")}</TabsTrigger>
              </TabsList>
              <TabsContent value="members">
                <MembersDataTable />
              </TabsContent>
              <TabsContent value="pending">
                <InvitationsDataTable />
              </TabsContent>
            </Tabs>
          </FormCardContent>
          <FormCardSeparator />
          <FormCardContent>
            <FormField
              control={form.control}
              disabled={locked}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("addMember")}</FormLabel>
                  <FormControl>
                    <Input
                      type="email"
                      placeholder={t("email")}
                      disabled={locked}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                  <FormCardDescription>
                    {t("addMemberDescription")}
                  </FormCardDescription>
                </FormItem>
              )}
            />
          </FormCardContent>
          <FormCardFooter>
            {locked ? (
              <>
                <FormCardFooterInfo>
                  {t("teamInvitesLocked")}{" "}
                  <Link
                    href="https://www.openstatus.dev/changelog/team-invites"
                    rel="noreferrer"
                    target="_blank"
                  >
                    {t("starterPlan")}
                  </Link>
                  .
                </FormCardFooterInfo>
                <Button type="button" size="sm" asChild>
                  <Link href="/settings/billing">
                    <Lock />
                    {t("upgrade")}
                  </Link>
                </Button>
              </>
            ) : (
              <Button type="submit" size="sm" disabled={isPending}>
                {isPending ? t("submitting") : t("submit")}
              </Button>
            )}
          </FormCardFooter>
        </FormCard>
      </form>
    </Form>
  );
}
