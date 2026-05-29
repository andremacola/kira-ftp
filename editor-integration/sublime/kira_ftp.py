# Kira FTP integration for Sublime Text.
# Drop this file into Packages/User/ (Sublime menu: Preferences → Browse Packages…).
# It adds commands that run the `kira` CLI on the current file.
#
# Commands (bind in Default.sublime-keymap):
#   kira_ftp { "action": "upload" | "download" | "sync-up" | "sync-down" | "sync" }
import os
import subprocess
import sublime
import sublime_plugin

# If `kira` isn't on Sublime's PATH, set the absolute path here.
KIRA_BIN = "kira"


class KiraFtpCommand(sublime_plugin.TextCommand):
    def run(self, edit, action="upload"):
        path = self.view.file_name()
        if not path:
            sublime.status_message("Kira FTP: save the file first")
            return

        # Save before upload-style actions so we send the latest content.
        if action in ("upload", "sync-up", "sync"):
            self.view.run_command("save")

        def worker():
            try:
                proc = subprocess.run(
                    [KIRA_BIN, action, path],
                    capture_output=True,
                    text=True,
                    timeout=120,
                    env=dict(os.environ),
                )
                out = (proc.stdout or proc.stderr or "").strip().splitlines()
                msg = out[-1] if out else ("ok" if proc.returncode == 0 else "failed")
                sublime.set_timeout(lambda: sublime.status_message("Kira FTP: " + msg), 0)
            except Exception as e:
                sublime.set_timeout(
                    lambda: sublime.status_message("Kira FTP error: " + str(e)), 0
                )

        sublime.set_timeout_async(worker, 0)
