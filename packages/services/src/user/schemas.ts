import { z } from "zod";

export const GetUserInput = z.object({ userId: z.number().int() });
export type GetUserInput = z.infer<typeof GetUserInput>;

export const UpdateUserProfileInput = z.object({
  name: z.string().trim().min(1).max(80),
});
export type UpdateUserProfileInput = z.infer<
  typeof UpdateUserProfileInput
>;

// `userId` is intentionally absent — the service derives it from
// `ctx.actor` so the caller can't target a different user's account.
// The schema is empty today and kept as a forward-compat object for
// future fields (e.g., reason / confirmation token).
export const DeleteAccountInput = z.object({}).strict();
export type DeleteAccountInput = z.infer<typeof DeleteAccountInput>;
