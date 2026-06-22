// @gigadrive/lupe-core — the review engine.

export const VERSION = '0.0.0';

// Domain model
export * from './finding';
export * from './diff';
export * from './review';
export * from './errors';
export * from './glob';
export * from './config';

// Ports (interfaces the engine depends on; implemented by adapters)
export * from './ports';

// AI layer
export * from './ai/model';
export * from './ai/provider';
export * from './ai/pricing';
export * from './ai/usage';
export * from './ai/tools';
export * from './ai/ai-sdk-layer';

// Review pipeline
export * from './review/prompt';
export * from './review/engine';
export * from './review/verify';
export * from './review/filter';
export * from './review/pipeline';

// Renderers
export * from './render/sarif';
export * from './render/markdown';
export * from './render/diff-prompt';

// Utilities
export { fnv1a } from './util/hash';
