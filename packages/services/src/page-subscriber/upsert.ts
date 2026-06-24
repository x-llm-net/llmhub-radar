import { and, eq, inArray, isNull, sql } from "@openstatus/db";
import {
  page,
  pageComponent,
  pageSubscriber,
  pageSubscriberToPageComponent,
  selectPageSubscriberSchema,
} from "@openstatus/db/src/schema";
import { assertSafeUrl } from "@openstatus/utils";

import { emitAudit } from "../audit";
import {
  type DB,
  type ServiceContext,
  getReadDb,
  withTransaction,
} from "../context";
import { NotFoundError, ValidationError } from "../errors";
import { parseWorkspaceForContext } from "./internal";
import { UpsertSelfSignupSubscriberInput } from "./schemas";

const VERIFICATION_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

export type UpsertSelfSignupResult = {
  id: number;
  pageId: number;
  pageName: string;
  pageSlug: string;
  customDomain: string | null;
  channelType: "email" | "webhook";
  email: string | null;
  webhookUrl?: string | null;
  token: string | null;
  acceptedAt: Date | null;
  unsubscribedAt?: Date | null;
  componentIds: number[];
};

/**
 * Self-signup entry point: a visitor on a public status page subscribes
 * by email. There is no authenticated actor and no `ctx.workspace` at
 * the call site 鈥?both are resolved from the page row inside this
 * function so audit emission still happens with a `subscriber` actor
 * attributable to the resulting `pageSubscriber.id`.
 *
 * Audit emission rules:
 *   - new row inserted          鈫?`page_subscriber.create`
 *   - pending row, scope merged 鈫?`page_subscriber.update` with
 *                                  `metadata: { componentIds: merged }`
 *                                  (otherwise diffTopLevel would skip a
 *                                  components-only change)
 *   - already verified row      鈫?no audit (no-op return)
 */
export async function upsertSelfSignupSubscriber(args: {
  input: UpsertSelfSignupSubscriberInput;
  db?: DB;
}): Promise<UpsertSelfSignupResult> {
  const input = UpsertSelfSignupSubscriberInput.parse(args.input);
  const componentIds = input.componentIds ?? [];

  const readDb = getReadDb({ db: args.db } as ServiceContext);
  const pageData = await readDb.query.page.findFirst({
    where: eq(page.id, input.pageId),
    with: { workspace: true },
  });
  if (!pageData) {
    throw new NotFoundError("page", input.pageId);
  }
  const workspace = parseWorkspaceForContext(pageData.workspace);
  // Public self-signup is core to LLMHub Radar v0, so it is not plan-gated.

  if (input.channelType === "webhook") {
    await assertSafeUrl(input.webhookUrl);
  }

  return withTransaction({ db: args.db } as ServiceContext, async (tx) => {
    if (componentIds.length > 0) {
      const valid = await tx
        .select({ id: pageComponent.id })
        .from(pageComponent)
        .where(
          and(
            eq(pageComponent.pageId, input.pageId),
            inArray(pageComponent.id, componentIds),
          ),
        )
        .all();
      if (valid.length !== componentIds.length) {
        throw new ValidationError("Some components do not belong to this page");
      }
    }

    if (input.channelType === "webhook") {
      const webhookUrl = input.webhookUrl;
      const channelConfig =
        input.headers && input.headers.length > 0
          ? JSON.stringify({ headers: input.headers })
          : null;

      const existing = await tx.query.pageSubscriber.findFirst({
        where: and(
          eq(pageSubscriber.pageId, input.pageId),
          sql`LOWER(${pageSubscriber.webhookUrl}) = ${webhookUrl.toLowerCase()}`,
          eq(pageSubscriber.channelType, "webhook"),
          isNull(pageSubscriber.unsubscribedAt),
        ),
        with: { components: true },
      });

      if (existing?.acceptedAt) {
        return {
          id: existing.id,
          pageId: existing.pageId,
          pageName: pageData.title,
          pageSlug: pageData.slug,
          customDomain: pageData.customDomain,
          channelType: existing.channelType,
          email: null,
          webhookUrl: existing.webhookUrl,
          token: existing.token,
          acceptedAt: existing.acceptedAt,
          componentIds: existing.components.map((c) => c.pageComponentId),
        };
      }

      if (existing) {
        const currentIds = existing.components.map((c) => c.pageComponentId);
        const mergedIds = [...new Set([...currentIds, ...componentIds])];
        const newIds = mergedIds.filter((id) => !currentIds.includes(id));

        if (newIds.length > 0) {
          await tx
            .insert(pageSubscriberToPageComponent)
            .values(
              newIds.map((compId) => ({
                pageSubscriberId: existing.id,
                pageComponentId: compId,
              })),
            )
            .onConflictDoNothing()
            .run();
        }

        const newExpiresAt = new Date(Date.now() + VERIFICATION_EXPIRY_MS);
        const beforeRow = selectPageSubscriberSchema.parse(existing);
        const updatedRow = await tx
          .update(pageSubscriber)
          .set({
            expiresAt: newExpiresAt,
            name: input.name ?? existing.name,
            channelConfig,
            updatedAt: new Date(),
          })
          .where(eq(pageSubscriber.id, existing.id))
          .returning()
          .get();
        const afterRow = selectPageSubscriberSchema.parse(
          updatedRow ?? existing,
        );

        const auditCtx: ServiceContext = {
          workspace,
          actor: { type: "subscriber", subscriberId: existing.id },
          db: tx,
        };
        const { token: _bt, ...beforeSnap } = beforeRow;
        const { token: _at, ...afterSnap } = afterRow;
        await emitAudit(tx, auditCtx, {
          action: "page_subscriber.update",
          entityType: "page_subscriber",
          entityId: existing.id,
          before: beforeSnap,
          after: afterSnap,
          ...(newIds.length > 0
            ? { metadata: { componentIds: mergedIds } }
            : {}),
        });

        return {
          id: existing.id,
          pageId: existing.pageId,
          pageName: pageData.title,
          pageSlug: pageData.slug,
          customDomain: pageData.customDomain,
          channelType: "webhook" as const,
          email: null,
          webhookUrl: existing.webhookUrl,
          token: existing.token,
          acceptedAt: null,
          componentIds: mergedIds,
        };
      }

      const token = crypto.randomUUID();
      const expiresAt = new Date(Date.now() + VERIFICATION_EXPIRY_MS);
      const inserted = await tx
        .insert(pageSubscriber)
        .values({
          channelType: "webhook",
          email: null,
          webhookUrl,
          channelConfig,
          pageId: input.pageId,
          source: "self_signup",
          name: input.name ?? null,
          token,
          expiresAt,
        })
        .returning()
        .get();

      if (componentIds.length > 0) {
        await tx
          .insert(pageSubscriberToPageComponent)
          .values(
            componentIds.map((compId) => ({
              pageSubscriberId: inserted.id,
              pageComponentId: compId,
            })),
          )
          .run();
      }

      const auditCtx: ServiceContext = {
        workspace,
        actor: { type: "subscriber", subscriberId: inserted.id },
        db: tx,
      };
      const { token: _t, ...after } = selectPageSubscriberSchema.parse(inserted);
      await emitAudit(tx, auditCtx, {
        action: "page_subscriber.create",
        entityType: "page_subscriber",
        entityId: inserted.id,
        after,
        ...(componentIds.length > 0 ? { metadata: { componentIds } } : {}),
      });

      return {
        id: inserted.id,
        pageId: inserted.pageId,
        pageName: pageData.title,
        pageSlug: pageData.slug,
        customDomain: pageData.customDomain,
        channelType: "webhook" as const,
        email: null,
        webhookUrl: inserted.webhookUrl,
        token: inserted.token,
        acceptedAt: inserted.acceptedAt ?? null,
        unsubscribedAt: inserted.unsubscribedAt ?? null,
        componentIds,
      };
    }

    const emailLower = input.email.toLowerCase();

    const existing = await tx.query.pageSubscriber.findFirst({
      where: and(
        eq(pageSubscriber.email, emailLower),
        eq(pageSubscriber.pageId, input.pageId),
        eq(pageSubscriber.channelType, "email"),
        isNull(pageSubscriber.unsubscribedAt),
      ),
      with: { components: true },
    });

    if (existing?.acceptedAt) {
      // Already verified 鈥?return as-is. Caller decides whether to surface
      // "already subscribed" to the visitor; no durable change here, no audit.
      return {
        id: existing.id,
        pageId: existing.pageId,
        pageName: pageData.title,
        pageSlug: pageData.slug,
        customDomain: pageData.customDomain,
        channelType: existing.channelType,
        email: existing.email ?? emailLower,
        token: existing.token,
        acceptedAt: existing.acceptedAt,
        componentIds: existing.components.map((c) => c.pageComponentId),
      };
    }

    if (existing) {
      // Pending row 鈥?merge components, refresh expiry.
      const currentIds = existing.components.map((c) => c.pageComponentId);
      const mergedIds = [...new Set([...currentIds, ...componentIds])];
      const newIds = mergedIds.filter((id) => !currentIds.includes(id));

      if (newIds.length > 0) {
        await tx
          .insert(pageSubscriberToPageComponent)
          .values(
            newIds.map((compId) => ({
              pageSubscriberId: existing.id,
              pageComponentId: compId,
            })),
          )
          .onConflictDoNothing()
          .run();
      }

      const newExpiresAt = new Date(Date.now() + VERIFICATION_EXPIRY_MS);
      const beforeRow = selectPageSubscriberSchema.parse(existing);
      const updatedRow = await tx
        .update(pageSubscriber)
        .set({ expiresAt: newExpiresAt, updatedAt: new Date() })
        .where(eq(pageSubscriber.id, existing.id))
        .returning()
        .get();
      const afterRow = selectPageSubscriberSchema.parse(updatedRow ?? existing);

      const auditCtx: ServiceContext = {
        workspace,
        actor: { type: "subscriber", subscriberId: existing.id },
        db: tx,
      };

      // Strip token (capability for self-manage / unsubscribe URLs).
      // Component scope changes don't show in the row diff 鈥?surface
      // them via metadata so the audit row carries actual signal.
      const { token: _bt, ...beforeSnap } = beforeRow;
      const { token: _at, ...afterSnap } = afterRow;
      await emitAudit(tx, auditCtx, {
        action: "page_subscriber.update",
        entityType: "page_subscriber",
        entityId: existing.id,
        before: beforeSnap,
        after: afterSnap,
        ...(newIds.length > 0 ? { metadata: { componentIds: mergedIds } } : {}),
      });

      return {
        id: existing.id,
        pageId: existing.pageId,
        pageName: pageData.title,
        pageSlug: pageData.slug,
        customDomain: pageData.customDomain,
        channelType: existing.channelType,
        email: existing.email ?? emailLower,
        token: existing.token,
        acceptedAt: null,
        componentIds: mergedIds,
      };
    }

    // No existing row 鈥?create.
    const token = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + VERIFICATION_EXPIRY_MS);
    const inserted = await tx
      .insert(pageSubscriber)
      .values({
        channelType: "email",
        email: emailLower,
        webhookUrl: null,
        pageId: input.pageId,
        source: "self_signup",
        token,
        expiresAt,
      })
      .returning()
      .get();

    if (componentIds.length > 0) {
      await tx
        .insert(pageSubscriberToPageComponent)
        .values(
          componentIds.map((compId) => ({
            pageSubscriberId: inserted.id,
            pageComponentId: compId,
          })),
        )
        .run();
    }

    const auditCtx: ServiceContext = {
      workspace,
      actor: { type: "subscriber", subscriberId: inserted.id },
      db: tx,
    };
    const { token: _t, ...after } = selectPageSubscriberSchema.parse(inserted);
    await emitAudit(tx, auditCtx, {
      action: "page_subscriber.create",
      entityType: "page_subscriber",
      entityId: inserted.id,
      after,
      ...(componentIds.length > 0 ? { metadata: { componentIds } } : {}),
    });

    return {
      id: inserted.id,
      pageId: inserted.pageId,
      pageName: pageData.title,
      pageSlug: pageData.slug,
      customDomain: pageData.customDomain,
      channelType: "email" as const,
      email: inserted.email ?? emailLower,
      token: inserted.token,
      acceptedAt: inserted.acceptedAt ?? null,
      unsubscribedAt: inserted.unsubscribedAt ?? null,
      componentIds,
    };
  });
}
