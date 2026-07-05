import type {
  ComposerPillAttrs,
  ComposerSnapshot,
} from "@src/components/ComposerInput/types";

const PLACEHOLDER_PREFIX = "ORGII_PILL";
const PLACEHOLDER_PATTERN = /\[\[ORGII_PILL_(\d+)\]\]/g;

export interface SnapshotPillPlaceholder {
  placeholder: string;
  attrs: ComposerPillAttrs;
}

export interface SnapshotPolishText {
  text: string;
  pills: SnapshotPillPlaceholder[];
}

function placeholderFor(index: number): string {
  return `[[${PLACEHOLDER_PREFIX}_${index}]]`;
}

function appendTextParts(parts: ComposerSnapshot["parts"], text: string): void {
  if (!text) return;

  const lines = text.split("\n");
  lines.forEach((line, index) => {
    if (index > 0) {
      parts.push({ kind: "newline" });
    }
    if (line) {
      parts.push({ kind: "text", text: line });
    }
  });
}

export function snapshotToPolishText(
  snapshot: ComposerSnapshot
): SnapshotPolishText {
  const pills: SnapshotPillPlaceholder[] = [];
  let text = "";

  for (const part of snapshot.parts) {
    if (part.kind === "text") {
      text += part.text;
      continue;
    }
    if (part.kind === "newline") {
      text += "\n";
      continue;
    }

    const placeholder = placeholderFor(pills.length);
    pills.push({
      placeholder,
      attrs: { ...part.attrs },
    });
    text += placeholder;
  }

  return { text, pills };
}

export function polishedTextToSnapshot(
  text: string,
  pills: ReadonlyArray<SnapshotPillPlaceholder>
): ComposerSnapshot | null {
  if (pills.length === 0) {
    const parts: ComposerSnapshot["parts"] = [];
    appendTextParts(parts, text);
    return { parts };
  }

  const parts: ComposerSnapshot["parts"] = [];
  const seen = new Set<number>();
  let cursor = 0;
  let expectedIndex = 0;

  for (const match of text.matchAll(PLACEHOLDER_PATTERN)) {
    const matchIndex = match.index;
    if (matchIndex == null) return null;

    const pillIndex = Number(match[1]);
    if (
      !Number.isInteger(pillIndex) ||
      pillIndex < 0 ||
      pillIndex >= pills.length ||
      pillIndex !== expectedIndex ||
      seen.has(pillIndex)
    ) {
      return null;
    }

    appendTextParts(parts, text.slice(cursor, matchIndex));
    parts.push({ kind: "pill", attrs: { ...pills[pillIndex].attrs } });

    seen.add(pillIndex);
    expectedIndex += 1;
    cursor = matchIndex + match[0].length;
  }

  if (seen.size !== pills.length) {
    return null;
  }

  appendTextParts(parts, text.slice(cursor));
  return { parts };
}

export function snapshotHasPolishableText(snapshot: ComposerSnapshot): boolean {
  return snapshot.parts.some(
    (part) => part.kind === "text" && part.text.trim().length > 0
  );
}

export function snapshotSignature(snapshot: ComposerSnapshot): string {
  return JSON.stringify(snapshot.parts);
}
