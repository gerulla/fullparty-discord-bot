import type { MessageCreateOptions } from "discord.js";

export type InspectableComponent = {
  type: number;
  content?: string;
  components?: InspectableComponent[];
  accessory?: InspectableComponent;
  custom_id?: string;
  url?: string;
  label?: string;
  style?: number;
  accent_color?: number;
  media?: { url: string };
};

export function messageComponents(message: unknown): InspectableComponent[] {
  const roots = (message as MessageCreateOptions).components as
    | InspectableComponent[]
    | undefined;
  const flatten = (component: InspectableComponent): InspectableComponent[] => {
    return [
      component,
      ...(component.components?.flatMap(flatten) ?? []),
      ...(component.accessory ? flatten(component.accessory) : []),
    ];
  };
  return (roots ?? []).flatMap(flatten);
}

export function messageText(message: unknown): string {
  return messageComponents(message)
    .map((c) => c.content ?? "")
    .filter(Boolean)
    .join("\n");
}
