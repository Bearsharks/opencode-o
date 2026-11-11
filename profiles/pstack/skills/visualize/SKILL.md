---
name: visualize
description: Explain a system or decision with a clear diagram or interactive local visualization, grounded in inspected evidence.
metadata:
  opencode/autoinvoke: false
---

# Visualize

Identify the relationship the reader needs to understand and inspect the underlying evidence. Choose the smallest representation that communicates it accurately.

- Use Mermaid for a compact flow or structure whose labels carry the meaning. Keep labels short and name the same concept consistently.
- Use a self-contained HTML artifact for interaction that reveals state, cause and effect, or comparisons. Reuse the project's rendering tools where appropriate. Test controls and resize behavior with `control-ui`, then link the actual file or served page.
- Use scientific plotting tools for measured data and export the figure with units, source, and uncertainty. Never invent measurements.
- When the requesting workflow requires a generated image, use an available image-generation tool and inspect its result. A text description of an image does not satisfy that requirement. This profile does not supply an image provider. If none is connected, mark image generation `NOT RUN` and name the missing capability.

For teaching a system with three or more moving parts, build a sequence of diagrams that each redraw the preceding picture and add one part. Preserve the source workflow's confidence language and required evidence. Do not replace a mandatory state model, verification result, or generated image with a decorative diagram.

Open and verify the artifact before reporting completion. Distinguish measured behavior from inference. Save deliverables in the project's established artifact location or a clearly named temporary directory and provide the actual path.
