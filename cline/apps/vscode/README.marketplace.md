# Unlok

<div align="center">
<table>
<tbody>
<td align="center">
<a href="https://marketplace.visualstudio.com/items?itemName=unlok.unlok-code" target="_blank"><strong>Download on VS Marketplace</strong></a>
</td>
<td align="center">
<a href="https://unlok-website.onrender.com" target="_blank"><strong>Website</strong></a>
</td>
<td align="center">
<a href="https://github.com/hexanams/unlok-tools" target="_blank"><strong>GitHub</strong></a>
</td>
</tbody>
</table>
</div>

Meet Unlok, an AI assistant that can use your **CLI** a**N**d **E**ditor.

Unlok handles complex software development tasks step-by-step, with tools that let it create & edit files, explore large projects, use the browser, and execute terminal commands (after you grant permission). It can assist you in ways that go beyond code completion or tech support, and can use the Model Context Protocol (MCP) to create new tools and extend its own capabilities. While autonomous AI scripts traditionally run in sandboxed environments, this extension provides a human-in-the-loop GUI to approve every file change and terminal command, providing a safe and accessible way to explore the potential of agentic AI.

1. Enter your task and add images to convert mockups into functional apps or fix bugs with screenshots.
2. Unlok starts by analyzing your file structure & source code ASTs, running regex searches, and reading relevant files to get up to speed in existing projects. By carefully managing what information is added to context, Unlok can provide valuable assistance even for large, complex projects without overwhelming the context window.
3. Once Unlok has the information it needs, it can:
    - Create and edit files + monitor linter/compiler errors along the way, proactively fixing issues like missing imports and syntax errors on its own.
    - Execute commands directly in your terminal and monitor their output as it works, reacting to dev server issues after editing a file.
    - For web development tasks, launch the site in a headless browser, click, type, scroll, and capture screenshots + console logs, fixing runtime errors and visual bugs.
4. When a task is completed, Unlok will present the result to you with a terminal command like `open -a "Google Chrome" index.html`, which you run with a click of a button.

---

### Sign in once, route through your workspace

Sign in with Unlok and every request auto-routes to the right tier — fast, cheap models for simple work, escalating to frontier models only when a task genuinely needs it. Every turn shows which model actually handled it and what it cost, so nothing is a black box.

Prefer direct control? Bring your own API keys instead — Unlok supports Anthropic, OpenAI, Google Gemini, Groq, and other leading providers, with the same cost and usage tracking either way.

### Run Commands in Terminal

Unlok can execute commands and receive their output to install packages, run build scripts, deploy applications, manage databases, and run tests, all while adapting to your dev environment & toolchain to get the job done right.

By default, commands run in a visible VS Code terminal, using the [shell integration API introduced in VSCode v1.93](https://code.visualstudio.com/updates/v1_93#_terminal-shell-integration-api) to stream output as commands run and let you watch or interact with them directly. You can switch to running commands in a background process instead (Settings → Terminal → Terminal Execution Mode).

### Create and Edit Files

Unlok can create and edit files directly in your editor, presenting you a diff view of the changes. You can edit or revert Unlok's changes directly in the diff view editor, or provide feedback in chat until you're satisfied with the result. Unlok also monitors linter/compiler errors (missing imports, syntax errors, etc.) so it can fix issues that come up along the way on its own.

All changes made by Unlok are recorded in your file's Timeline, providing an easy way to track and revert modifications if needed.

### Use the Browser

Unlok can launch a browser, click elements, type text, and scroll, capturing screenshots and console logs at each step. This allows for interactive debugging, end-to-end testing, and even general web use, giving it autonomy to fix visual bugs and runtime issues without you needing to handhold and copy-paste error logs yourself.

Try asking Unlok to "test the app," and watch as it runs a command like `npm run dev`, launches your locally running dev server in a browser, and performs a series of tests to confirm that everything works.

### "add a tool that..."

Thanks to the [Model Context Protocol](https://github.com/modelcontextprotocol), Unlok can extend its capabilities through custom tools. While you can use [community-made servers](https://github.com/modelcontextprotocol/servers), Unlok can instead create and install tools tailored to your specific workflow. Just ask it to "add a tool" and it will handle everything, from creating a new MCP server to installing it into the extension. These custom tools then become part of Unlok's toolkit, ready to use in future tasks.

-   "add a tool that fetches Jira tickets": Retrieve ticket ACs and put Unlok to work
-   "add a tool that manages AWS EC2s": Check server metrics and scale instances up or down
-   "add a tool that pulls the latest PagerDuty incidents": Fetch details and ask Unlok to fix bugs

### Add Context

**`@url`:** Paste in a URL for the extension to fetch and convert to markdown, useful when you want to give Unlok the latest docs

**`@problems`:** Add workspace errors and warnings ('Problems' panel) for Unlok to fix

**`@file`:** Adds a file's contents so you don't have to waste API requests approving read file (+ type to search files)

**`@folder`:** Adds folder's files all at once to speed up your workflow even more

### Checkpoints: Compare and Restore

As Unlok works through a task, the extension takes a snapshot of your workspace at each step. You can use the 'Compare' button to see a diff between the snapshot and your current workspace, and the 'Restore' button to roll back to that point.

For example, when working with a local web server, you can use 'Restore Workspace Only' to quickly test different versions of your app, then use 'Restore Task and Workspace' when you find the version you want to continue building from. This lets you safely explore different approaches without losing progress.

## Contributing

To contribute to the project, start with our [Contributing Guide](CONTRIBUTING.md) to learn the basics.

## License

[Apache 2.0 © 2026 Unlok](./LICENSE)
