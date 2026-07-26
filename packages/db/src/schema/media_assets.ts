import { relations, sql } from "drizzle-orm";
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import { user } from "./users";
import { workspace } from "./workspaces";

export const mediaPurposes = ["claim_evidence", "order_receipt"] as const;
export const mediaVisibilities = ["private", "public"] as const;

export const mediaAsset = sqliteTable(
  "media_asset",
  {
    id: text("id", { length: 36 }).primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    ownerUserId: integer("owner_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    purpose: text("purpose", { enum: mediaPurposes }).notNull(),
    visibility: text("visibility", { enum: mediaVisibilities })
      .default("private")
      .notNull(),
    storageKey: text("storage_key", { length: 160 }).notNull(),
    originalFilename: text("original_filename", { length: 255 }).notNull(),
    mimeType: text("mime_type", { length: 100 }).notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" }).default(
      sql`(strftime('%s', 'now'))`,
    ),
    updatedAt: integer("updated_at", { mode: "timestamp" }).default(
      sql`(strftime('%s', 'now'))`,
    ),
  },
  (t) => [
    uniqueIndex("media_asset_storage_key_idx").on(t.storageKey),
    index("media_asset_owner_expiry_idx").on(t.ownerUserId, t.expiresAt),
    index("media_asset_workspace_purpose_idx").on(t.workspaceId, t.purpose),
    index("media_asset_expiry_idx").on(t.expiresAt),
  ],
);

export const mediaAssetRelations = relations(mediaAsset, ({ one }) => ({
  workspace: one(workspace, {
    fields: [mediaAsset.workspaceId],
    references: [workspace.id],
  }),
  owner: one(user, {
    fields: [mediaAsset.ownerUserId],
    references: [user.id],
  }),
}));
