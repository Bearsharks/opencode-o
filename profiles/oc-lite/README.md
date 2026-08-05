# oc-lite profile

`oc-lite` is a single-primary-worker profile with one read-only Runner.

```text
worker --task--> runner
runner           --------> none
```

The Worker performs implementation directly. Its prompt keeps only role,
context management, reading strategy, and completion conditions. Runner is
copied from Max with its read-only permissions and evidence-backed compact
result contract.

The topology plugin only enforces the two-agent task graph. It does not provide
orchestration, Terra workers, A-Max background execution, Kanban, or custom
tools.

Use the profile through the separately installed `oc-lite` wrapper:

```bash
./scripts/install/oc-lite.sh
oc-lite
oc-lite run "Hello"
```
