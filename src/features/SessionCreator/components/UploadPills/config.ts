/**
 * UploadPills Configuration
 */
import Archive from "@hugeicons/core-free-icons/ArchiveIcon";
import Code from "@hugeicons/core-free-icons/CodeIcon";
import File from "@hugeicons/core-free-icons/File01Icon";
import FileText from "@hugeicons/core-free-icons/File02Icon";
import Folder from "@hugeicons/core-free-icons/Folder01Icon";
import ImageIcon from "@hugeicons/core-free-icons/Image01Icon";
import Sheet from "@hugeicons/core-free-icons/SheetIcon";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";

type LucideIcon = IconSvgElement;

// ============================================
// Icon Configuration
// ============================================

const IMAGE_EXTENSIONS = [
  "jpg",
  "jpeg",
  "png",
  "gif",
  "svg",
  "webp",
  "bmp",
  "ico",
];

/**
 * Get file type icon component based on file name and type
 */
export const getFileTypeIcon = (
  fileName: string,
  fileType: string
): LucideIcon => {
  const ext = fileName.split(".").pop()?.toLowerCase();

  if (fileType === "image" || IMAGE_EXTENSIONS.includes(ext || "")) {
    return ImageIcon;
  }

  // Document files
  if (["pdf"].includes(ext || "")) {
    return FileText; // PDF icon - using FileText as closest match
  }
  if (["doc", "docx"].includes(ext || "")) {
    return FileText; // Word document
  }
  if (["xls", "xlsx", "numbers"].includes(ext || "")) {
    return Sheet; // Excel/Spreadsheet
  }
  if (["ppt", "pptx"].includes(ext || "")) {
    return FileText; // PowerPoint - using FileText as closest match
  }

  // Code files
  if (
    [
      "js",
      "ts",
      "jsx",
      "tsx",
      "py",
      "java",
      "c",
      "cpp",
      "h",
      "rs",
      "go",
    ].includes(ext || "")
  ) {
    return Code;
  }

  // Text files
  if (["txt", "md", "json", "xml", "yaml", "yml"].includes(ext || "")) {
    return FileText;
  }

  // Archive files
  if (["zip", "tar", "gz", "rar", "7z"].includes(ext || "")) {
    return Archive;
  }

  // Folder
  if (fileType === "folder") {
    return Folder;
  }

  // Default file icon
  return File;
};

// ============================================
// Style Configuration
// ============================================

export const STYLE_CONFIG = {
  /** Maximum width for file name before truncation */
  maxNameWidth: "120px",
  /** Pill border radius */
  borderRadius: "8px",
  /** Pill padding */
  padding: "8px 12px",
  /** Gap between pills */
  gap: "8px",
} as const;
