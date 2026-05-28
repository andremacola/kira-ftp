/**
 * Ambient module shims for untyped transitive deps that Electrobun's shipped
 * TypeScript source imports (three/babylon are only used by its WGPU APIs,
 * which we don't touch). Silences implicit-any errors from node_modules .ts.
 */
declare module "three";
declare module "@babylonjs/core";
