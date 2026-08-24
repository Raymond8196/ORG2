/**
 * Retryable lazy-component cache scoped by workstation tab type.
 *
 * A renderer can contain more than one lazy boundary. Caching only the outer
 * registry component leaves a rejected module-level inner `React.lazy` object
 * alive forever because webpack does not re-execute an already-loaded wrapper
 * module. Every retryable boundary therefore registers in the same tab-type
 * scope, and Retry evicts the entire scope before the boundary re-renders.
 */
import type { ComponentType, LazyExoticComponent } from "react";

import type { WorkStationTabType } from "@src/store/workstation/tabs/types";
import {
  type ImportRetryOptions,
  lazyWithRetry,
} from "@src/util/core/init/lazyWithRetry";

import { REGISTRY } from "./registry";
import type { UnifiedTabContentProps } from "./types";

type LazyModule<P> = Promise<{ default: ComponentType<P> }>;
type RendererComponent = LazyExoticComponent<
  ComponentType<UnifiedTabContentProps>
>;

const ROOT_RENDERER_KEY = "__renderer_root__";
const cache = new Map<WorkStationTabType, Map<string, unknown>>();

/**
 * Return a stable lazy component until its tab-type scope is invalidated.
 * Call this while rendering, not in a module-level constant: after eviction the
 * next render must be able to obtain the newly constructed lazy object.
 */
export function getRendererLazyComponent<P>(
  type: WorkStationTabType,
  key: string,
  load: () => LazyModule<P>,
  options: ImportRetryOptions = {}
): LazyExoticComponent<ComponentType<P>> {
  let scopedCache = cache.get(type);
  if (!scopedCache) {
    scopedCache = new Map<string, unknown>();
    cache.set(type, scopedCache);
  }

  const cached = scopedCache.get(key) as
    | LazyExoticComponent<ComponentType<P>>
    | undefined;
  if (cached) return cached;

  const component = lazyWithRetry(load, { label: key, ...options });
  scopedCache.set(key, component);
  return component;
}

/** Get (or build) the registry renderer for a tab type. */
export function getRendererComponent(
  type: WorkStationTabType
): RendererComponent | null {
  const entry = REGISTRY[type];
  if (!entry) return null;

  return getRendererLazyComponent(type, ROOT_RENDERER_KEY, entry.load, {
    label: entry.debugLabel ?? type,
  });
}

/** Evict the outer renderer and every inner lazy boundary for this tab type. */
export function invalidateRendererComponents(type: WorkStationTabType): void {
  cache.delete(type);
}

/** Test seam — drops every cached component. */
export function __resetRendererComponentCache(): void {
  cache.clear();
}
