/**
 * Signal atom — increment to request the session creator to open its
 * agent/category picker palette immediately on next render.
 *
 * Consumers watch this counter and open their local palette state when
 * the value changes (comparing against a ref of the last-seen value).
 */
import { atom } from "jotai";

export const openCategoryPickerSignalAtom = atom(0);
openCategoryPickerSignalAtom.debugLabel = "openCategoryPickerSignal";
