import { readState, STATE_FILE } from "./utils/state.js";

const s = readState();
if (Object.keys(s).length === 0) {
  console.log(`No state yet (${STATE_FILE})`);
  process.exit(0);
}
// The baseline is large (it carries the whole prompt): print its size, not its body.
const { agent_baseline, ...rest } = s;
console.log(JSON.stringify({ ...rest, agent_baseline: agent_baseline ? `<${JSON.stringify(agent_baseline).length} bytes>` : undefined }, null, 2));
