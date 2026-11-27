# PRD review brief

The goal is to help the author by finding what the PRD missed. Do not argue with it or grade it.

The input is the PRD folder at the commit SHA given at the end of this brief, together with the originals the PRD cites. Read files with `git show <SHA>:<path>`. In `request.md` only the lines that start with `> ` are the user's words. Do not take the author's source labels on trust; check them against the originals. Read repository documents and code the PRD does not cite when you need them.

Judge the PRD against the goal and form in the [feature PRD skill](../SKILL.md): can an implementer learn from this PRD alone what the user wanted and why? For each miss, state what is absent or inconsistent and where its basis is (the user's words, a PRD row, a contract's location). Do not write the fix. Mark what the user must decide. Whether the feature will succeed once built is not in question yet.

Start `EVIDENCE` with `nothing missed` or with the list of misses.
