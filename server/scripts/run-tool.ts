// Runs a single agent tool from the CLI, e.g.
// npm run tool -- resolve_airports '{"query":"New England"}'
import { tools } from "../src/agent/tools/index.js";

async function main(): Promise<void> {
  const [name, rawArgs] = process.argv.slice(2);
  if (!name) {
    console.error("Usage: npm run tool -- <toolName> '<json args>'");
    console.error("Available tools:", tools.map((t) => t.name).join(", "));
    process.exitCode = 1;
    return;
  }

  const toolInstance = tools.find((t) => t.name === name);
  if (!toolInstance) {
    console.error(`Unknown tool "${name}". Available tools:`, tools.map((t) => t.name).join(", "));
    process.exitCode = 1;
    return;
  }

  let args: unknown = {};
  if (rawArgs) {
    try {
      args = JSON.parse(rawArgs);
    } catch (err) {
      console.error("Failed to parse args as JSON:", err instanceof Error ? err.message : err);
      process.exitCode = 1;
      return;
    }
  }

  const result = await toolInstance.invoke({
    name,
    args: args as Record<string, unknown>,
    id: "cli-call",
    type: "tool_call"
  });

  console.log("--- content (what the LLM sees) ---");
  console.log(result.content);
  console.log("\n--- artifact (full structured result) ---");
  console.log(JSON.stringify(result.artifact, null, 2));
}

main().catch((err) => {
  console.error("Tool run failed:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
