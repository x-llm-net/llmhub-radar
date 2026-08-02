ALTER TABLE "hub_group_models" ADD COLUMN "relay_channel_binding_id" uuid;--> statement-breakpoint
ALTER TABLE "hub_group_models" ADD CONSTRAINT "hub_group_models_relay_channel_binding_id_hub_relay_channel_bindings_id_fk" FOREIGN KEY ("relay_channel_binding_id") REFERENCES "public"."hub_relay_channel_bindings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "hub_group_models_relay_binding_idx" ON "hub_group_models" USING btree ("relay_channel_binding_id");
