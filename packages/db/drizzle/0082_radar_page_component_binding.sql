ALTER TABLE `radar_target_openstatus_binding` ADD `page_component_id` integer REFERENCES `page_component`(`id`) ON DELETE set null;
--> statement-breakpoint
CREATE INDEX `radar_binding_page_component_id_idx` ON `radar_target_openstatus_binding` (`page_component_id`);
--> statement-breakpoint
INSERT INTO `page_component` (
  `workspace_id`,
  `page_id`,
  `type`,
  `monitor_id`,
  `name`,
  `description`,
  `order`,
  `created_at`,
  `updated_at`
)
SELECT
  rt.`workspace_id`,
  rp.`page_id`,
  'static',
  NULL,
  rt.`display_name`,
  CASE
    WHEN rc.`model_group` IS NOT NULL AND rc.`model_group` <> ''
      THEN 'Type: ' || rc.`model_group` || ' | Probe model: ' || rt.`model_name`
    ELSE 'Probe model: ' || rt.`model_name`
  END,
  rt.`id`,
  strftime('%s', 'now'),
  strftime('%s', 'now')
FROM `radar_probe_target` rt
INNER JOIN `radar_pool` rp ON rp.`id` = rt.`pool_id`
LEFT JOIN `radar_credential` rc ON rc.`id` = rt.`credential_id`
LEFT JOIN `radar_target_openstatus_binding` b ON b.`target_id` = rt.`id`
LEFT JOIN `page_component` bound_pc ON bound_pc.`id` = b.`page_component_id`
WHERE rp.`page_id` IS NOT NULL
  AND bound_pc.`id` IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM `page_component` pc
    WHERE pc.`workspace_id` = rt.`workspace_id`
      AND pc.`page_id` = rp.`page_id`
      AND pc.`type` = 'static'
      AND pc.`order` = rt.`id`
  );
--> statement-breakpoint
INSERT INTO `radar_target_openstatus_binding` (
  `workspace_id`,
  `pool_id`,
  `target_id`,
  `page_id`,
  `page_component_id`,
  `created_at`,
  `updated_at`
)
SELECT
  rt.`workspace_id`,
  rt.`pool_id`,
  rt.`id`,
  rp.`page_id`,
  pc.`id`,
  strftime('%s', 'now'),
  strftime('%s', 'now')
FROM `radar_probe_target` rt
INNER JOIN `radar_pool` rp ON rp.`id` = rt.`pool_id`
INNER JOIN `page_component` pc
  ON pc.`workspace_id` = rt.`workspace_id`
  AND pc.`page_id` = rp.`page_id`
  AND pc.`type` = 'static'
  AND pc.`order` = rt.`id`
LEFT JOIN `radar_target_openstatus_binding` b ON b.`target_id` = rt.`id`
WHERE rp.`page_id` IS NOT NULL
  AND b.`id` IS NULL;
--> statement-breakpoint
UPDATE `radar_target_openstatus_binding`
SET
  `page_id` = COALESCE(
    `page_id`,
    (
      SELECT rp.`page_id`
      FROM `radar_probe_target` rt
      INNER JOIN `radar_pool` rp ON rp.`id` = rt.`pool_id`
      WHERE rt.`id` = `radar_target_openstatus_binding`.`target_id`
      LIMIT 1
    )
  ),
  `page_component_id` = (
    SELECT pc.`id`
    FROM `radar_probe_target` rt
    INNER JOIN `radar_pool` rp ON rp.`id` = rt.`pool_id`
    INNER JOIN `page_component` pc
      ON pc.`workspace_id` = rt.`workspace_id`
      AND pc.`page_id` = rp.`page_id`
      AND pc.`type` = 'static'
      AND pc.`order` = rt.`id`
    WHERE rt.`id` = `radar_target_openstatus_binding`.`target_id`
    LIMIT 1
  ),
  `updated_at` = strftime('%s', 'now')
WHERE `page_component_id` IS NULL;
