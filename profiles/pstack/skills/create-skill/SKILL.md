---
name: create-skill
description: Create or revise an OpenCode skill with explicit invocation policy, verified paths, and concrete task instructions.
metadata:
  opencode/autoinvoke: false
---

# Create a skill

1. Identify the reusable task, triggers, expected output, and constraints from the request and existing evidence. Inspect nearby skills before creating another. Ask only for missing choices that change the result.
2. Choose the destination. Preserve an existing personal skill's category. New project skills belong in `.opencode/skills/<name>/SKILL.md`. Project overrides of this profile's bundled skills belong in `.opencode/pstack/skills/<name>/SKILL.md`. Profile-wide personal skills and overrides belong in `$OPENCODE_CONFIG_DIR/local-skills/<name>/SKILL.md`. Never modify the managed bundled skills or a package cache. Copy a complete skill folder for an override and verify relative links outside that folder.
3. Write a focused `SKILL.md` with YAML frontmatter. `name` must match the folder, and `description` must say when to use it. Generated personal modes default to `metadata: {opencode/autoinvoke: false}`. Set the value to `true` only when the user requests automatic invocation. Automatic invocation eligibility does not make a mode persistent on every turn. For persistence, the user enables `/pstack-mode on <name>`.
4. State executable steps and decision conditions. Keep reference material in linked files and repeated deterministic operations in scripts. Use available OpenCode tools and their actual schemas. Every delegated task includes a pstack `role`; panel delegates include a `seat`. Keep filenames, outputs, error handling, and verification concrete. Do not add permissions or external actions beyond the user's task.
5. Validate the frontmatter, directory name, linked files, script syntax, and invocation metadata. Reload the native skill catalogue and confirm the actual content and flag, then explicitly load it in a disposable session. Report what was checked and any untested behavior. Apply `unslop` to the prose.

Minimal personal-mode frontmatter:

```yaml
---
name: example-mode
description: Apply the user's agreed working preferences when explicitly requested.
metadata:
  opencode/autoinvoke: false
---
```
