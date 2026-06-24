"use server";

import { db, eq } from "@openstatus/db";
import {
  session,
  user,
  usersToWorkspaces,
  workspace,
} from "@openstatus/db/src/schema";
import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { redirect } from "next/navigation";
import { z } from "zod";

import { signIn } from "@/lib/auth";
import { createUser } from "@/lib/auth/helpers";

const devEmailSchema = z.email().transform((value) => value.toLowerCase());

export async function signInWithResendAction(formData: FormData) {
  try {
    await signIn("resend", formData);
  } catch (e) {
    if (isRedirectError(e)) throw e;
    console.error(e);
  }
}

function getSafeRedirectTo(value: FormDataEntryValue | null): string {
  if (typeof value !== "string" || !value) return "/radar";

  try {
    const target = new URL(value, "http://localhost");
    if (
      (target.protocol === "http:" || target.protocol === "https:") &&
      target.pathname.startsWith("/") &&
      !target.pathname.startsWith("//") &&
      target.pathname !== "/login"
    ) {
      return `${target.pathname}${target.search}${target.hash}`;
    }
  } catch {
    // fall through to the default dashboard route
  }

  return "/radar";
}

async function getFirstWorkspaceSlug(userId: number) {
  const [membership] = await db
    .select({ slug: workspace.slug })
    .from(usersToWorkspaces)
    .innerJoin(workspace, eq(workspace.id, usersToWorkspaces.workspaceId))
    .where(eq(usersToWorkspaces.userId, userId))
    .all();

  return membership?.slug;
}

export async function signInWithDevEmailAction(formData: FormData) {
  if (process.env.NODE_ENV !== "development") {
    throw new Error("Development email sign-in is only available in dev mode.");
  }

  const email = devEmailSchema.parse(formData.get("email"));
  const redirectTo = getSafeRedirectTo(formData.get("redirectTo"));

  const existingUser = await db
    .select()
    .from(user)
    .where(eq(user.email, email))
    .get();

  const authUser =
    existingUser ??
    (await createUser({
      email,
      image: "",
      name: email.split("@")[0],
    }));

  const token = randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  await db
    .insert(session)
    .values({
      sessionToken: token,
      userId: authUser.id,
      expires,
    })
    .run();

  const cookieStore = await cookies();
  cookieStore.set("authjs.session-token", token, {
    expires,
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    secure: false,
  });

  const workspaceSlug = await getFirstWorkspaceSlug(authUser.id);
  if (workspaceSlug) {
    cookieStore.set("workspace-slug", workspaceSlug, {
      expires,
      path: "/",
      sameSite: "lax",
      secure: false,
    });
  }

  redirect(redirectTo);
}
