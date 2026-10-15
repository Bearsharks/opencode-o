import { updateState } from "../../src/state.ts";

const [dir, name] = process.argv.slice(2);
updateState(dir!, (s) => {
  s.agents.push({ name: name!, role: "feature", contextDir: "", cwd: "", branch: "", createdAt: "" });
});
