import { and, eq } from "@openstatus/db";
import { invitation, pageSubscriber } from "@openstatus/db/src/schema";
import { EmailClient } from "@openstatus/emails";
import { notifyMaintenance } from "@openstatus/services/maintenance";
import { notifyStatusReport } from "@openstatus/services/status-report";
import { getChannel } from "@openstatus/subscriptions";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { env } from "../../env";
import { toServiceCtx, toTRPCError } from "../../service-adapter";
import {
  createTRPCRouter,
  protectedProcedure,
  publicProcedure,
} from "../../trpc";
import { getPublicStatusPageUrl } from "../statusPage.links";

const emailClient = new EmailClient({ apiKey: env.RESEND_API_KEY });

export const emailRouter = createTRPCRouter({
  /**
   * PUBLIC: Send verification email for a new page subscription
   * Called after upsert to trigger the verification flow
   */
  sendPageSubscriptionVerification: publicProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        token: z.uuid(),
        locale: z.string().optional(),
      }),
    )
    .mutation(async (opts) => {
      const subscriber = await opts.ctx.db.query.pageSubscriber.findFirst({
        where: and(
          eq(pageSubscriber.id, opts.input.id),
          eq(pageSubscriber.token, opts.input.token),
        ),
        with: {
          page: {
            with: {
              workspace: true,
            },
          },
        },
      });

      if (!subscriber) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Subscriber not found",
        });
      }

      if (!subscriber.email) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No email associated with this subscription",
        });
      }

      if (subscriber.acceptedAt) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Subscription already verified",
        });
      }

      if (!subscriber.token) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Subscription has no verification token",
        });
      }

      const verifyUrl = `${getPublicStatusPageUrl({
        customDomain: subscriber.page.customDomain,
        slug: subscriber.page.slug,
      })}/verify/${subscriber.token}`;

      const channel = getChannel("email");
      if (!channel) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Email channel not found",
        });
      }

      await channel.sendVerification?.(
        {
          id: subscriber.id,
          pageId: subscriber.pageId,
          pageName: subscriber.page.title,
          pageSlug: subscriber.page.slug,
          customDomain: subscriber.page.customDomain,
          componentIds: [],
          channelType: "email",
          email: subscriber.email,
          token: subscriber.token,
          acceptedAt: subscriber.acceptedAt ?? undefined,
          locale: opts.input.locale,
        },
        verifyUrl,
      );

      return { success: true };
    }),

  /**
   * PROTECTED: Send status report update notifications via dispatcher
   */
  sendStatusReport: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async (opts) => {
      try {
        await notifyStatusReport({
          ctx: toServiceCtx(opts.ctx),
          input: { statusReportUpdateId: opts.input.id },
        });
        return { success: true };
      } catch (err) {
        toTRPCError(err);
      }
    }),

  /**
   * PROTECTED: Send maintenance notifications via dispatcher
   */
  sendMaintenance: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async (opts) => {
      try {
        await notifyMaintenance({
          ctx: toServiceCtx(opts.ctx),
          input: { maintenanceId: opts.input.id },
        });
        return { success: true };
      } catch (err) {
        toTRPCError(err);
      }
    }),

  sendTeamInvitation: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        baseUrl: z.string().optional(),
        locale: z.string().optional(),
      }),
    )
    .mutation(async (opts) => {
      const _invitation = await opts.ctx.db.query.invitation.findFirst({
        where: and(
          eq(invitation.id, opts.input.id),
          eq(invitation.workspaceId, opts.ctx.workspace.id),
        ),
      });

      if (!_invitation) return;

      await emailClient.sendTeamInvitation({
        to: _invitation.email,
        token: _invitation.token,
        invitedBy: `${opts.ctx.user.email}`,
        workspaceName: opts.ctx.workspace.name || undefined,
        baseUrl: opts.input.baseUrl,
        locale: opts.input.locale,
      });
    }),
});
