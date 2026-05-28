import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { useUi } from "../ui-store";

export function PromptDialog() {
  const prompt = useUi((s) => s.prompt);
  const close = useUi((s) => s.closePrompt);
  const [value, setValue] = useState("");

  useEffect(() => {
    if (prompt) setValue(prompt.defaultValue);
  }, [prompt]);

  const submit = async () => {
    if (!prompt) return;
    await prompt.onSubmit(value);
    close();
  };

  return (
    <Dialog open={!!prompt} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{prompt?.title}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-1.5">
          <Label>{prompt?.label}</Label>
          <Input
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submit();
            }}
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button onClick={() => void submit()}>{prompt?.confirmText ?? "OK"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
