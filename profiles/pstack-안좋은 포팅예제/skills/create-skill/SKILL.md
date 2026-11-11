---
name: create-skill
description: Create or update an OpenCode skill with focused instructions,
  required frontmatter, and working local references. Use for authoring SKILL.md
  files.
metadata:
  opencode/autoinvoke: true
---

# Create an OpenCode skill

Respect the requested scope and location. For project skills use `.opencode/skills/<name>/SKILL.md`; for this profile use `$OPENCODE_CONFIG_DIR/skills/<name>/SKILL.md`. Keep additions in the selected OpenCode scope and preserve unrelated configuration.

Use YAML frontmatter with `name` equal to the directory name (lowercase letters, digits and hyphens, at most 64 characters) and a nonempty `description` explaining when the skill applies. Put the procedure and its constraints in the body. Keep detailed references next to the skill and link them explicitly. Include scripts only when deterministic execution improves the actual workflow.

Preserve user authorization boundaries. A skill does not grant permission to message people, deploy, delete data, or expand the task. Identify optional tools and a real fallback when they are absent. Do not claim a harness feature exists without checking it.

Validate frontmatter, resolve relative links, and run any new helpers against a disposable fixture. For this profile run `bun run check:pstack` from its repository root and use `/reload` to refresh the skill catalog. Existing generated skills are maintained through the profile sync script and overrides; record intentional upstream changes before resyncing.
