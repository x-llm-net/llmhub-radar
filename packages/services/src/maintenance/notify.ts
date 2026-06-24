import { db as defaultDb, eq } from "@openstatus/db";
import { maintenance } from "@openstatus/db/src/schema";
import { dispatchMaintenanceUpdate } from "@openstatus/subscriptions";

import { requireScope } from "../auth";
import type { ServiceContext } from "../context";
import { ForbiddenError, NotFoundError } from "../errors";
import { NotifyMaintenanceInput } from "./schemas";

/**
 * Dispatch subscriber notifications for a maintenance. Separate from the
 * create/update mutations because the dashboard runs on Edge and cannot
 * fire-and-forget 鈥?callers invoke this as a second awaited call.
 *
 * Enforces:
 *   - Workspace owns the target maintenance.
 *   - Subscriber notifications are available as a core LLMHub Radar feature.
 */
export async function notifyMaintenance(args: {
  ctx: ServiceContext;
  input: NotifyMaintenanceInput;
}): Promise<void> {
  const { ctx } = args;
  requireScope(ctx, "write");
  const input = NotifyMaintenanceInput.parse(args.input);
  const db = ctx.db ?? defaultDb;

  const row = await db
    .select({ id: maintenance.id, workspaceId: maintenance.workspaceId })
    .from(maintenance)
    .where(eq(maintenance.id, input.maintenanceId))
    .get();

  if (!row) {
    throw new NotFoundError("maintenance", input.maintenanceId);
  }
  if (row.workspaceId !== ctx.workspace.id) {
    throw new ForbiddenError("Maintenance does not belong to this workspace.");
  }

  await dispatchMaintenanceUpdate(input.maintenanceId);
}
