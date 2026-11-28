# Free playbook

The goal is what the request asks for. No step, order, or artifact is required.

This playbook grants no authority: commit, push, open a PR, or merge only when the user allows it.

Each skill below defines one artifact from the inputs it needs. When the work needs one, read that skill and produce the artifact as it defines.

| Skill | Needs | Artifact |
|---|---|---|
| [blite-feature](../skills/blite-feature/SKILL.md) | The request | PRD folder with `request.md` and `index.md` |
| [blite-architecture](../skills/blite-architecture/SKILL.md) | `index.md` | `design.md` |
| [blite-checks](../skills/blite-checks/SKILL.md) | `index.md` | `checks.md` |
| [blite-build](../skills/blite-build/SKILL.md) | `index.md`, `design.md`, `checks.md` | Verified implementation and a ready PR at a pinned head |
| [blite-shipping](../skills/blite-shipping/SKILL.md) | That PR and the PRD folder at its head | Both review verdicts and the merge commit |
