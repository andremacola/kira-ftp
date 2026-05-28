# AGENTS.md - Global Guidelines & Context Index

## Commands Tools

### Save Session

**Trigger:** user says "save session".

Run:
- Create a new file in [`docs/agent-sessions/`](./docs/agent-sessions/) providing a detailed summary of the session with the following format: `docs/agent-sessions/session-<date>-<topic>.md` or analyse past sessions filenames.

### Save Plan

**Trigger:** user says "save plan".

Run:
- Create a comprehensive hand-off document in [`docs/plans/`](./docs/plans/) for another agent. Include implementation plan, detail your reasoning (assuming zero prior knowledge), our chat context, and a granular list of execution tasks.

### btca

When the user says "use btca" for codebase/docs questions. The codebase in btca is always up to date.

Run:
- `btca ask --sub-agent -r <resource> -q '<question>'`
- Or use `-r <resource>` for multiple: `btca --sub-agent ask -r electrobun -r bun -q '<question>'`

Available resources: electrobun, tailwindcss, lucide-icons, bun, rclone

For more information on how to use btca, use your SKILLS

### Commit Messages

- When the user says "commit", generate a message and commit ONLY for the files YOU HAVE WORKED on during the current session.
- When the user says "commit staged", generate a message and commit for ALL the files in the STAGED area.
- When the user says "commit all", generate a message and commit for ALL the files CHANGED in the repository.

## Documentation References

Alternative to btca, use these documentations when working on the project. They are here to help you understand the codebase and best practices, but you should not follow them blindly. Keep the codebase as simple as possible and use your best judgement for the task.

- [React](https://react.dev/llms.txt)
- [Shadcn](https://ui.shadcn.com/llms.txt)
- [Bun](https://bun.sh/docs/llms.txt)
- [Electrobun](https://blackboard.sh/electrobun/docs/guides/quick-start/)
- [Rclone](https://rclone.org/docs/) — also the [rc remote-control API](https://rclone.org/rc/)
- [Tailwind CSS v4](https://tailwindcss.com/docs)
- [Vite](https://vite.dev/guide/)
- [Zustand](https://zustand.docs.pmnd.rs/)
- [TanStack Query](https://tanstack.com/query/latest/docs/framework/react/overview)
- [lucide-react](https://lucide.dev/guide/packages/lucide-react)
- [CodeMirror 6](https://codemirror.net/docs/)
- [ssh2](https://github.com/mscdex/ssh2#readme) (SFTP backend)
- [basic-ftp](https://github.com/patrickjuchli/basic-ftp#readme) (FTP/FTPS backend)

### Before Starting Work
- **!IMPORTANT: Follow Development General Rules** (in the section below) when doing ANY kind of work
- **!IMPORTANT: Check existing patterns**: Review similar files in the codebase for coding style and best practices
- **Prioritization**: Whenever possible, prioritize the use of sub-agents for low-complexity tasks, such as searching for context, performing web searches, visiting websites, or analyzing documentation.
- **Search**: Before start any work, you should search for the latest information on the web using `btca` or the documentation references above. If using a year in the search, use 2025 (we are in the middle of 2026).

### Development General Rules
- **NEVER** use any other package manager or runtime than `bun`
- **NEVER** run `bun run dev` or any dev server - it's already running in a separate terminal
- **NEVER** run or create tests unless explicitly requested by the user
- **NEVER** use `any` type - use `unknown` instead if type is unknown
- **NEVER** use ENUMs without explicit permission and solid justification
- **NEVER** install packages, tools, or system dependencies without explicit user approval
- **NEVER** make any change on production servers without explicit user approval
- **ALWAYS** use `lucide-react` for icons
- **ALWAYS** check if a utility/helper function exists in codebase before writing a new one
- **ALWAYS** consult ONLINE documentation for the latest stable versions before adding or upgrading dependencies

### Code Comments Rules
- Keep comments **short and objective**. No essays, no marketing copy, no narrative.
- Document the **WHY**, not the **WHAT**. If the code is self-explanatory, omit the comment.
- One-line comments preferred. Multi-line only when documenting a non-obvious constraint, invariant, or workaround.
- **Never** describe the current task, the PR, or who added it. Comments outlive PRs and rot fast.
- **Never** cite plans, specs, ADRs, or other docs by section number (e.g. `plan §16.3`, `ADR-007`, `RFC §4.2`). Restate the constraint inline — section numbers drift and the reader is in the code, not in the doc.
- File-level JSDoc/block: 3-5 lines max stating purpose and non-obvious invariants.

### Documentation Standards
- All markdown docs, plans, and code comments **MUST BE in English**
