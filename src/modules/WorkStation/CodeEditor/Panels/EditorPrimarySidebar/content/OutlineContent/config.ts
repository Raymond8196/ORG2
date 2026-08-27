/**
 * OutlineView Configuration
 *
 * Icons and constants for the outline view
 */
import Box from "@hugeicons/core-free-icons/BoxIcon";
import Code from "@hugeicons/core-free-icons/CodeIcon";
import FileCode from "@hugeicons/core-free-icons/FileScriptIcon";
import Braces from "@hugeicons/core-free-icons/FirstBracketIcon";
import FunctionSquare from "@hugeicons/core-free-icons/FunctionSquareIcon";
import Hash from "@hugeicons/core-free-icons/HashtagIcon";
import Type from "@hugeicons/core-free-icons/TypeIcon";
import Variable from "@hugeicons/core-free-icons/VariableIcon";
import type { IconSvgElement } from "@hugeicons/react";

import type { SymbolKind } from "./types";

/**
 * Icon configuration for different symbol kinds
 */
export const SYMBOL_ICONS: Record<SymbolKind, IconSvgElement> = {
  function: FunctionSquare,
  class: Box,
  interface: Braces,
  type: Type,
  const: Variable,
  let: Variable,
  var: Variable,
  export: FileCode,
  import: FileCode,
  method: Code,
  property: Hash,
  enum: Braces,
};

/**
 * Color classes for different symbol kinds
 * Uses design system colors for proper light/dark theme support
 */
export const SYMBOL_COLORS: Record<SymbolKind, string> = {
  function: "text-primary-6",
  class: "text-warning-6",
  interface: "text-primary-6",
  type: "text-purple-6",
  const: "text-success-6",
  let: "text-success-6",
  var: "text-success-6",
  export: "text-warning-5",
  import: "text-warning-5",
  method: "text-primary-5",
  property: "text-text-2",
  enum: "text-danger-6",
};

/**
 * Display names for symbol kinds
 */
export const SYMBOL_LABELS: Record<SymbolKind, string> = {
  function: "Function",
  class: "Class",
  interface: "Interface",
  type: "Type",
  const: "Constant",
  let: "Variable",
  var: "Variable",
  export: "Export",
  import: "Import",
  method: "Method",
  property: "Property",
  enum: "Enum",
};
