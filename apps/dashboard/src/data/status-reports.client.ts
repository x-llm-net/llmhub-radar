import { Cog, Eye, Plus, Trash2 } from "lucide-react";

export type StatusReportActionLabels = {
  settings: string;
  createUpdate: string;
  viewReport: string;
  delete: string;
};

export const actions = [
  {
    id: "edit",
    label: "Settings",
    icon: Cog,
    variant: "default" as const,
  },
  {
    id: "create-update",
    label: "Create Update",
    icon: Plus,
    variant: "default" as const,
  },
  {
    id: "view-report",
    label: "View Report",
    icon: Eye,
    variant: "default" as const,
  },
  {
    id: "delete",
    label: "Delete",
    icon: Trash2,
    variant: "destructive" as const,
  },
] as const;

type StatusReportUpdateActionBase = (typeof actions)[number];

export type StatusReportUpdateAction = Omit<
  StatusReportUpdateActionBase,
  "label"
> & {
  label: string;
};

export const getActions = (
  props: Partial<
    Record<StatusReportUpdateAction["id"], () => Promise<void> | void>
  >,
  labels?: StatusReportActionLabels,
): (StatusReportUpdateAction & { onClick?: () => Promise<void> | void })[] => {
  const labelById = {
    edit: labels?.settings,
    "create-update": labels?.createUpdate,
    "view-report": labels?.viewReport,
    delete: labels?.delete,
  } satisfies Record<StatusReportUpdateAction["id"], string | undefined>;

  return actions.map((action) => ({
    ...action,
    label: labelById[action.id] ?? action.label,
    onClick: props[action.id as keyof typeof props],
  }));
};
