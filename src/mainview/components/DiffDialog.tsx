import { useEffect, useRef } from "react";
import { MergeView } from "@codemirror/merge";
import { EditorView } from "@codemirror/view";
import { githubDark } from "@uiw/codemirror-theme-github";
import { Dialog, DialogContent } from "./ui/dialog";
import { useUi } from "../ui-store";
import { languageFor } from "../lib/codemirror";

export function DiffDialog() {
  const diff = useUi((s) => s.diff);
  const close = useUi((s) => s.closeDiff);
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!diff || !host.current) return;
    const lang = languageFor(diff.filename);
    const readOnly = [EditorView.editable.of(false), githubDark, ...lang];
    const view = new MergeView({
      a: { doc: diff.leftText, extensions: readOnly },
      b: { doc: diff.rightText, extensions: readOnly },
      parent: host.current,
      gutter: true,
    });
    return () => view.destroy();
  }, [diff]);

  return (
    <Dialog open={!!diff} onOpenChange={(o) => !o && close()}>
      <DialogContent className="flex h-[80vh] max-w-5xl flex-col gap-0 overflow-hidden p-0">
        <div className="flex items-center border-b border-border px-4 py-2 text-[12px]">
          <span className="flex-1 font-mono text-emerald-500">{diff?.leftLabel}</span>
          <span className="flex-1 text-right font-mono text-sky-500">{diff?.rightLabel}</span>
        </div>
        <div ref={host} className="min-h-0 flex-1 overflow-auto text-[13px]" />
      </DialogContent>
    </Dialog>
  );
}
