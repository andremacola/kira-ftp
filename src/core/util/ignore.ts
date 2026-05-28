/**
 * Ignore-pattern matching. We store user patterns as regexes (Sublime SFTP
 * compatible) and also expose rclone glob filters for the bulk sync engine.
 */
import type { IgnoreRule } from "../../shared/domain";

/** Compile enabled rules into RegExp objects, skipping invalid ones. */
export function compileRules(rules: IgnoreRule[]): RegExp[] {
  const out: RegExp[] = [];
  for (const r of rules) {
    if (!r.enabled) continue;
    try {
      out.push(new RegExp(r.pattern));
    } catch {
      // ignore malformed pattern rather than crash an operation
    }
  }
  return out;
}

/** True if a path matches any compiled ignore regex (tested both separators). */
export function isIgnored(path: string, regexes: RegExp[]): boolean {
  if (regexes.length === 0) return false;
  const unix = path.replace(/\\/g, "/");
  const win = path.replace(/\//g, "\\");
  return regexes.some((re) => re.test(unix) || re.test(win));
}

/**
 * Translate stored regex patterns into rclone ExcludeRule glob filters where
 * possible. rclone uses globs, not regex, so we keep this conservative:
 * simple patterns map directly; anything with regex metachars is wrapped with
 * rclone's `{{ regexp }}` syntax which it supports for advanced matching.
 */
export function rulesToRcloneFilters(rules: IgnoreRule[]): string[] {
  const filters: string[] = [];
  for (const r of rules) {
    if (!r.enabled) continue;
    const p = r.pattern.trim();
    if (!p) continue;
    // rclone supports regex via {{...}}; wrap to preserve user intent.
    filters.push(`{{${p}}}`);
  }
  return filters;
}

/** Sensible default ignores seeded into new projects. */
export const DEFAULT_IGNORE_PATTERNS: string[] = [
  "\\.git(/|$)",
  "\\.svn(/|$)",
  "\\.hg(/|$)",
  "\\.DS_Store$",
  "(/|^)node_modules(/|$)",
  "\\.sublime-(project|workspace)$",
  "sftp-config(-alt\\d?)?\\.json$",
  "\\.swp$",
];
