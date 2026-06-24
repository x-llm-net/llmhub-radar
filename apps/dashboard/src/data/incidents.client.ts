import { Bookmark, Check, Trash2 } from "lucide-react";

export const actions = [
  {
    id: "acknowledge",
    label: "Acknowledge",
    icon: Bookmark,
    variant: "default" as const,
  },
  {
    id: "resolve",
    label: "Resolve",
    icon: Check,
    variant: "default" as const,
  },
  {
    id: "delete",
    label: "Delete",
    icon: Trash2,
    variant: "destructive" as const,
  },
] as const;

export type IncidentAction = (typeof actions)[number];
type IncidentActionWithHandler = Omit<IncidentAction, "label"> & {
  label: string;
  onClick?: () => Promise<void> | void;
};

export const getActions = (
  props: Partial<Record<IncidentAction["id"], () => Promise<void> | void>>,
  labels?: Partial<Record<IncidentAction["id"], string>>,
): IncidentActionWithHandler[] => {
  return actions.map((action) => ({
    ...action,
    label: labels?.[action.id] ?? action.label,
    onClick: props[action.id as keyof typeof props],
  }));
};
