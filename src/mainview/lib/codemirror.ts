/** Shared CodeMirror language detection by filename extension. */
import type { Extension } from "@codemirror/state";
import { javascript } from "@codemirror/lang-javascript";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { python } from "@codemirror/lang-python";
import { php } from "@codemirror/lang-php";
import { sql } from "@codemirror/lang-sql";

export function languageFor(name: string): Extension[] {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  switch (ext) {
    case "js":
    case "jsx":
    case "mjs":
    case "cjs":
      return [javascript({ jsx: true })];
    case "ts":
    case "tsx":
      return [javascript({ jsx: true, typescript: true })];
    case "html":
    case "htm":
      return [html()];
    case "css":
    case "scss":
      return [css()];
    case "json":
      return [json()];
    case "md":
    case "markdown":
      return [markdown()];
    case "py":
      return [python()];
    case "php":
      return [php()];
    case "sql":
      return [sql()];
    default:
      return [];
  }
}
