import type { LucideIcon } from "lucide-react";
import { Cog, LayoutGrid, Logs, Siren } from "lucide-react";

export const MONITOR_TABS: {
  value: string;
  icon: LucideIcon;
}[] = [
  { value: "overview", icon: LayoutGrid },
  { value: "logs", icon: Logs },
  { value: "incidents", icon: Siren },
  { value: "edit", icon: Cog },
];
