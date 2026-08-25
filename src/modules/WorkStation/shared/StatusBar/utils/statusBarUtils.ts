import { getLanguageDisplayNameFromPath } from "@src/config/languageMap";

export function getLanguageFromPath(filePath?: string): string {
  return getLanguageDisplayNameFromPath(filePath);
}
