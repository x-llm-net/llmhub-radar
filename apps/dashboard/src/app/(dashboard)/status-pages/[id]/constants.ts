import type { LucideIcon } from "lucide-react";
import { Cog, Hammer, LayoutTemplate, Megaphone, Users } from "lucide-react";

export const STATUS_PAGE_TABS: {
  value: string;
  icon: LucideIcon;
}[] = [
  { value: "status-reports", icon: Megaphone },
  { value: "maintenances", icon: Hammer },
  { value: "subscribers", icon: Users },
  { value: "components", icon: LayoutTemplate },
  { value: "edit", icon: Cog },
];
