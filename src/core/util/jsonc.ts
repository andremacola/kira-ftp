/**
 * Minimal JSONC parser: tolerates // and block comments and trailing commas,
 * which editor config files (VS Code, Zed, Sublime) commonly use. Comment
 * stripping is string-aware so // or *​/ inside string values is preserved.
 */
export function parseJsonc(input: string): unknown {
  const text = input.replace(/^﻿/, ""); // strip BOM
  let out = "";
  let inStr = false;
  let inLine = false;
  let inBlock = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    const n = text[i + 1];
    if (inLine) {
      if (c === "\n") {
        inLine = false;
        out += c;
      }
      continue;
    }
    if (inBlock) {
      if (c === "*" && n === "/") {
        inBlock = false;
        i++;
      }
      continue;
    }
    if (inStr) {
      out += c;
      if (c === "\\") {
        out += text[i + 1] ?? "";
        i++;
      } else if (c === '"') {
        inStr = false;
      }
      continue;
    }
    if (c === '"') {
      inStr = true;
      out += c;
      continue;
    }
    if (c === "/" && n === "/") {
      inLine = true;
      i++;
      continue;
    }
    if (c === "/" && n === "*") {
      inBlock = true;
      i++;
      continue;
    }
    out += c;
  }
  out = out.replace(/,(\s*[}\]])/g, "$1"); // drop trailing commas
  return JSON.parse(out);
}

/** Parse JSONC expecting a top-level array; returns [] on empty/invalid. */
export function parseJsoncArray(text: string): unknown[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const parsed = parseJsonc(trimmed);
  return Array.isArray(parsed) ? parsed : [];
}
