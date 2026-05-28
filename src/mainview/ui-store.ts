/**
 * Transient UI state: which modals/dialogs are open and their parameters.
 * Kept separate from the data store so re-renders stay localized.
 */
import { create } from "zustand";
import type { Connection, SyncPlan } from "@shared/domain";

interface PromptConfig {
  title: string;
  label: string;
  defaultValue: string;
  confirmText?: string;
  onSubmit: (value: string) => void | Promise<void>;
}

interface ConfirmConfig {
  title: string;
  message: string;
  destructive?: boolean;
  onConfirm: () => void | Promise<void>;
}

interface SyncPreviewConfig {
  plan: SyncPlan;
  direction: "up" | "down";
  onRun: () => void | Promise<void>;
}

interface EditorConfig {
  connectionId: number;
  remotePath: string;
  name: string;
}

interface DiffConfig {
  title: string;
  leftLabel: string;
  rightLabel: string;
  leftText: string;
  rightText: string;
  filename: string;
}

interface UiState {
  connectionDialog: { open: boolean; editing: Connection | null };
  projectDialog: boolean;
  commandPalette: boolean;
  settingsOpen: boolean;
  prompt: PromptConfig | null;
  confirm: ConfirmConfig | null;
  syncPreview: SyncPreviewConfig | null;
  editor: EditorConfig | null;
  diff: DiffConfig | null;

  openConnectionDialog: (editing?: Connection | null) => void;
  closeConnectionDialog: () => void;
  openProjectDialog: () => void;
  closeProjectDialog: () => void;
  toggleCommandPalette: (open?: boolean) => void;
  openSettings: () => void;
  closeSettings: () => void;
  showPrompt: (cfg: PromptConfig) => void;
  closePrompt: () => void;
  showConfirm: (cfg: ConfirmConfig) => void;
  closeConfirm: () => void;
  showSyncPreview: (cfg: SyncPreviewConfig) => void;
  closeSyncPreview: () => void;
  openEditor: (cfg: EditorConfig) => void;
  closeEditor: () => void;
  showDiff: (cfg: DiffConfig) => void;
  closeDiff: () => void;
}

export const useUi = create<UiState>((set) => ({
  connectionDialog: { open: false, editing: null },
  projectDialog: false,
  commandPalette: false,
  settingsOpen: false,
  prompt: null,
  confirm: null,
  syncPreview: null,
  editor: null,
  diff: null,

  openConnectionDialog: (editing = null) =>
    set({ connectionDialog: { open: true, editing } }),
  closeConnectionDialog: () => set({ connectionDialog: { open: false, editing: null } }),
  openProjectDialog: () => set({ projectDialog: true }),
  closeProjectDialog: () => set({ projectDialog: false }),
  toggleCommandPalette: (open) =>
    set((s) => ({ commandPalette: open ?? !s.commandPalette })),
  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),
  showPrompt: (cfg) => set({ prompt: cfg }),
  closePrompt: () => set({ prompt: null }),
  showConfirm: (cfg) => set({ confirm: cfg }),
  closeConfirm: () => set({ confirm: null }),
  showSyncPreview: (cfg) => set({ syncPreview: cfg }),
  closeSyncPreview: () => set({ syncPreview: null }),
  openEditor: (cfg) => set({ editor: cfg }),
  closeEditor: () => set({ editor: null }),
  showDiff: (cfg) => set({ diff: cfg }),
  closeDiff: () => set({ diff: null }),
}));
