/**
 * Owns JSON, YAML, and Markdown artifact I/O beneath one workspace root.
 * The boundary rejects traversal and symbolic links.
 * It hides internal revision data and writes individual files atomically.
 * Domain owners supply schemas instead of the workspace redefining them.
 */

export {};
