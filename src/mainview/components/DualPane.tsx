import { FilePane } from "./FilePane";

export function DualPane() {
  return (
    <main className="flex min-w-0 flex-1">
      <FilePane pane="local" />
      <div className="w-px bg-border" />
      <FilePane pane="remote" />
    </main>
  );
}
