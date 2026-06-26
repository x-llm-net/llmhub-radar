import { and, eq, isNull } from "@openstatus/db";
import { user } from "@openstatus/db/src/schema";

import { requireScope } from "../auth";
import {
  type ServiceContext,
  tryGetActorUserId,
  withTransaction,
} from "../context";
import { NotFoundError, UnauthorizedError } from "../errors";
import { UpdateUserProfileInput } from "./schemas";

export async function updateUserProfile(args: {
  ctx: ServiceContext;
  input: UpdateUserProfileInput;
}) {
  const { ctx } = args;
  requireScope(ctx, "write");
  const input = UpdateUserProfileInput.parse(args.input);
  const userId = tryGetActorUserId(ctx.actor);

  if (userId == null) {
    throw new UnauthorizedError("Profile update requires a known user actor.");
  }

  return withTransaction(ctx, async (tx) => {
    const existing = await tx
      .select()
      .from(user)
      .where(and(eq(user.id, userId), isNull(user.deletedAt)))
      .get();

    if (!existing) throw new NotFoundError("user", userId);

    return tx
      .update(user)
      .set({
        name: input.name,
        updatedAt: new Date(),
      })
      .where(eq(user.id, userId))
      .returning()
      .get();
  });
}
