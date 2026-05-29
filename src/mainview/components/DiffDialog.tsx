import { useCallback, useRef } from "react";
import { MergeView } from "@codemirror/merge";
import { EditorView } from "@codemirror/view";
import { githubDark } from "@uiw/codemirror-theme-github";
import { Dialog, DialogContent, DialogTitle } from "./ui/dialog";
import { useUi } from "../ui-store";
import { languageFor } from "../lib/codemirror";

export function DiffDialog() {
  const diff = useUi((s) => s.diff);
  const close = useUi((s) => s.closeDiff);
  const viewRef = useRef<MergeView | null>(null);

  // Callback ref: build the MergeView the moment the host node mounts (avoids
  // useEffect/ref timing races with the Radix portal + lazy mount). React calls
  // this with `null` on unmount, which is where we tear the view down.
  const mountHost = useCallback((node: HTMLDivElement | null) => {
    viewRef.current?.destroy();
    viewRef.current = null;
    if (!node) return;
    const d = useUi.getState().diff;
    if (!d) return;
    try {
      // Editors grow to content height; the dialog body (host) provides the
      // single scrollbar, which also keeps both sides scrolling together.
      const ext = [EditorView.editable.of(false), githubDark, ...languageFor(d.filename)];
      viewRef.current = new MergeView({
        a: { doc: d.leftText, extensions: ext },
        b: { doc: d.rightText, extensions: ext },
        parent: node,
        gutter: true,
      });
    } catch (err) {
      console.error("Failed to build diff view:", err);
      node.textContent = `Failed to render diff: ${(err as Error).message}`;
    }
  }, []);

  return (
    <Dialog open={!!diff} onOpenChange={(o) => !o && close()}>
      <DialogContent className="flex h-[80vh] max-w-5xl flex-col gap-0 overflow-hidden p-0">
        <DialogTitle className="sr-only">Diff</DialogTitle>
        {/* pr-10 reserves room for the dialog's close (X) button at top-right */}
        <div className="flex items-center gap-3 border-b border-border py-2 pl-4 pr-10 text-[12px]">
          {/* truncate from the LEFT (rtl) so the filename at the end stays visible */}
          <span
            className="min-w-0 flex-1 truncate font-mono text-emerald-500 [direction:rtl] text-left"
            title={diff?.leftLabel}
          >
            &#8206;{diff?.leftLabel}
          </span>
          <span
            className="min-w-0 flex-1 truncate font-mono text-sky-500 [direction:rtl] text-left"
            title={diff?.rightLabel}
          >
            &#8206;{diff?.rightLabel}
          </span>
        </div>
        {/* key forces a fresh host node per diff so the callback ref re-runs */}
        <div
          key={diff ? `${diff.leftLabel}|${diff.rightLabel}` : "none"}
          ref={mountHost}
          className="min-h-0 flex-1 overflow-auto text-[13px]"
        />
      </DialogContent>
    </Dialog>
  );
}
