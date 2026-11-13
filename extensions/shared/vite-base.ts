// The part of every extension's vite config that is the same: the build-time language define and the
// merge with the SDK's config. The caller passes vite's `mergeConfig` and the SDK's result, because
// this folder has no node_modules of its own to import them from.
import { setupLanguage } from './build-lib.mjs';

type Merge = (a: any, b: any) => any;

/** `base` (from createExtensionConfig) plus `__SETUP_LANGUAGE__` and whatever `extra` adds (define, build). */
export function extensionConfig(mergeConfig: Merge, base: object, extra: { define?: object; build?: object } = {}) {
  return mergeConfig(base, {
    ...extra,
    define: { ...extra.define, __SETUP_LANGUAGE__: JSON.stringify(setupLanguage()) },
  });
}
