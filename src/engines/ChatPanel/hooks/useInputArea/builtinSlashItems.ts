import { SLASH_ACTIONS, type SlashItem } from "@src/types/extensions";

interface BuildBuiltinSlashItemsOptions {
  canvasDescription: string;
  compactDescription: string;
  addressCommentsItem?: SlashItem | null;
}

/** Shared built-in command registry for ChatPanel and Session Creator. */
export function buildBuiltinSlashItems({
  canvasDescription,
  compactDescription,
  addressCommentsItem,
}: BuildBuiltinSlashItemsOptions): SlashItem[] {
  return [
    {
      name: SLASH_ACTIONS.CANVAS,
      description: canvasDescription,
      category: "action",
      source: "builtin",
      acceptsArgs: true,
    },
    {
      name: SLASH_ACTIONS.COMPACT,
      description: compactDescription,
      category: "action",
      source: "builtin",
      acceptsArgs: true,
    },
    ...(addressCommentsItem ? [addressCommentsItem] : []),
  ];
}
