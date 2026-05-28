import { useEffect, useMemo, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { githubDark } from "@uiw/codemirror-theme-github";
import { Loader2, Save } from "lucide-react";
import { Dialog, DialogContent } from "./ui/dialog";
import { Button } from "./ui/button";
import { useUi } from "../ui-store";
import { api } from "../lib/rpc";
import { languageFor } from "../lib/codemirror";

export function RemoteEditor() {
  const editor = useUi((s) => s.editor);
  const close = useUi((s) => s.closeEditor);
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!editor) return;
    setLoading(true);
    setDirty(false);
    api
      .readRemoteText({ connectionId: editor.connectionId, remotePath: editor.remotePath })
      .then((text) => setContent(text))
      .catch((e) => setContent(`// Failed to load: ${(e as Error).message}`))
      .finally(() => setLoading(false));
  }, [editor]);

  const extensions = useMemo(() => (editor ? languageFor(editor.name) : []), [editor]);

  const save = async () => {
    if (!editor) return;
    setSaving(true);
    try {
      await api.saveRemoteText({
        connectionId: editor.connectionId,
        remotePath: editor.remotePath,
        text: content,
      });
      setDirty(false);
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s" && editor) {
        e.preventDefault();
        void save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, content]);

  return (
    <Dialog open={!!editor} onOpenChange={(o) => !o && close()}>
      <DialogContent className="flex h-[80vh] max-w-4xl flex-col gap-0 overflow-hidden p-0">
        <div className="flex items-center gap-2 border-b border-border px-4 py-2">
          <span className="font-mono text-[12px]">{editor?.remotePath}</span>
          {dirty && <span className="text-[11px] text-amber-500">● unsaved</span>}
          <div className="ml-auto">
            <Button size="sm" onClick={() => void save()} disabled={saving || loading}>
              {saving ? <Loader2 className="animate-spin" /> : <Save />}
              Save
            </Button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          {loading ? (
            <div className="grid h-full place-items-center text-xs text-muted-foreground">
              <Loader2 className="size-5 animate-spin" />
            </div>
          ) : (
            <CodeMirror
              value={content}
              theme={githubDark}
              extensions={extensions}
              onChange={(v) => {
                setContent(v);
                setDirty(true);
              }}
              height="100%"
              style={{ height: "100%", fontSize: 13 }}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
