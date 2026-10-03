// Host-provided module (externalized at build time). Only the parts used here.
declare module '@nimbalyst/runtime' {
  import type { ComponentType } from 'react';

  export interface TranscriptMarkdownContribution {
    remarkPlugins?: ReadonlyArray<unknown>;
    rehypePlugins?: ReadonlyArray<unknown>;
    components?: Readonly<Record<string, ComponentType<any>>>;
    styles?: ReadonlyArray<{ id: string; type: 'css-text'; cssText: string } | { id: string; type: 'stylesheet'; href: string }>;
  }

  export function setTranscriptMarkdownContributions(source: string, contribution: TranscriptMarkdownContribution): void;
  export function clearTranscriptMarkdownContributions(source: string): void;
}
