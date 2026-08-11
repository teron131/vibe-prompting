/**
 * Owns immutable full-snapshot artifact history beneath `.prompting`.
 * History has one current pointer and a linear parent chain.
 * Revert restores selected content and appends a revision with `restoredFrom`.
 * Revert never rewinds history or adds branch, merge, or acceptance state.
 */

export {};
