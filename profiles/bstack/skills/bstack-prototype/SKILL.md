---
name: bstack-prototype
description: Decide one ambiguous criterion with a throwaway observation.
---

**bstack 실행 경계 (아래 원본에서 이 부분만 대체):** 격리된 일회용 비교만 한다. 대화 내 목업은 사용자에게 실제로 비교를 요청한다. 기획 결정을 가를 때는 메인이 허용된 임시 환경에서 작은 실험을 직접 수행하고 조건·결과·한계를 PRD에 남긴다. 필요한 권한이나 표면이 실제로 없을 때만 사용자에게 요청한다. 미실행을 실험 성공으로 바꾸지 않고 Feature로 진행하지 않는다.

### Prototype

**You own the design decision, not the code. The prototype is a throwaway instrument. The real build follows Feature.**

The one playbook where the Laziness Protocol's "smallest change" and the verification bar invert. Speed over polish, code quality does not matter, no planning. The rigor is in picking the right design cheaply. Propose variations the user didn't ask for, throw an approach away and try another.

1. Scope the decision the prototype exists to make: which layout, which interaction, which density, or for an empirical fork which behavior, timing, or approach. No decision means no prototype. Route to Feature.
2. Gather references when the design space is open. Search for prior art, summarize a moodboard of themes, palettes, and layouts, let the user pick directions before building. Skip when the direction is set.
3. Build throwaway in an isolated scratch dir, separate from production source. For a visual decision, vanilla HTML/CSS/JS or the lightest stack that renders the idea, CDN deps, a dev server with hot reload. For a behavioral or timing decision, the smallest script that exercises the question. No production framework, no tests, no abstractions.
4. When comparing alternatives, build them behind one switcher (buttons or a keypress), each variant labeled. This is the **exhaust-the-design-space** principle skill made cheap.
5. Verify on the matching surface. For a visual decision, screenshot each variant via the control skill and drive the interaction. For a behavioral or timing decision, observe the thing you are deciding by logging the timing, printing the output, or watching the render. The observation is the test here, not an assertion.
6. Present alternatives, tradeoffs, and a recommendation. The output is the decision plus the throwaway artifact, not shippable code. Hand the chosen direction to **Feature** (or `architect` for the shape) for the real build.

**Reply:** the variants explored, the evidence (screenshots for a visual decision, the observed output or timing for a behavioral one), tradeoffs, your recommendation, and the scratch path. Say plainly that the prototype is throwaway.
