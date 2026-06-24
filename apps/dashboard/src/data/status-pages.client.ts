import { Cog, Copy, Trash2 } from "lucide-react";

const defaultLabels = {
  edit: "Settings",
  "copy-id": "Copy ID",
  delete: "Delete",
};

export const actions = [
  {
    id: "edit",
    label: defaultLabels.edit,
    icon: Cog,
    variant: "default" as const,
  },
  {
    id: "copy-id",
    label: defaultLabels["copy-id"],
    icon: Copy,
    variant: "default" as const,
  },
  // {
  //   id: "create-badge",
  //   label: "Create Badge",
  //   icon: Tag,
  //   variant: "default" as const,
  // },
  {
    id: "delete",
    label: defaultLabels.delete,
    icon: Trash2,
    variant: "destructive" as const,
  },
] as const;

export type StatusPageAction = (typeof actions)[number];
export type LocalizedStatusPageAction = Omit<StatusPageAction, "label"> & {
  label: string;
};

export const getActions = (
  props: Partial<Record<StatusPageAction["id"], () => Promise<void> | void>>,
  labels: Partial<Record<StatusPageAction["id"], string>> = {},
): (LocalizedStatusPageAction & { onClick?: () => Promise<void> | void })[] => {
  return actions.map((action) => ({
    ...action,
    label: labels[action.id] ?? action.label,
    onClick: props[action.id as keyof typeof props],
  }));
};
