---
name: btca
description: Use btca to fetch up-to-date answers about external libraries/frameworks by searching their official documentation locally (source-first, no web browsing).
---

# better-context (btca)

btca is a Bun-powered CLI for getting **up-to-date** answers about libraries/frameworks by **cloning/pulling their repositories locally** and querying the code/docs.

## When to use btca

Use btca when the user asks about an **external technology** (not this repo), for example:

- How a library/framework works internally
- Exact API behavior, defaults, edge cases, version-specific changes
- "What does the source/docs say?" questions that must be current

## How to use btca (workflow)

1. Ask a single, precise question

- `btca ask --sub-agent -r <tech> -q '<question>'`
- Or use `-r <resource>` for multiple: `btca --sub-agent ask -r svelte -r shadcn-svelte -q '<question>'`
- You can also use @mentions in the question: `btca --sub-agent ask -q 'How do @svelte stores work?'`

Available <tech>: electrobun, tailwindcss, lucide-icons, bun, rclone
