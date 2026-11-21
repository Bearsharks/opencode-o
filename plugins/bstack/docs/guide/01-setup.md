# Set up bstack

## Install the plugin

From your target project, start Claude Code with the local plugin directory:

```sh
claude --plugin-dir /absolute/path/to/plugins/bstack
```

Make sure Python 3 and `oc-lite` are available. In Claude Code, use the `bstack:` prefix for plugin skills; the rest of the guide shortens some examples.

## Pick your models

Run [`/bstack:setup-bstack`](../../skills/setup-bstack/SKILL.md). It checks `oc-lite models`, asks you to confirm a model and optional variant per role and panel seat, and replaces the plugin's `config/models.json`. New launches use the new settings. See the [Claude Code harness](../harness/claude-code.md) for the launcher and worker lifecycle.

Use a cheaper model or supported variant for ordinary work if cost matters. Choose the `hard` role only for the hardest work. A panel runs independently once per seat; use more seats only when the decision benefits from them.

## Get a verification harness

Run [`/bstack:create-verification-skill`](../../skills/create-verification-skill/SKILL.md) if the project lacks a way for workers to drive the real artifact. It creates a project-local skill under `.claude/skills/`. [Verify and ship](./06-verify-and-ship.md#create-a-project-verification-skill) covers it in depth.

## Run your first task

```text
/bstack:bstack-mode Find why the search results flicker on refresh. Done means the fix reproduces the old behavior in a regression test that now passes.
```

Next: [Route work through `/bstack-mode`](./02-bstack-mode.md).
