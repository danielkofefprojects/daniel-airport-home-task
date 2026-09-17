import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { SeedData } from "../src/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEED_PATH = path.resolve(__dirname, "../data/seed/airports.json");

const SAMPLE_IATAS = ["SFO", "LAX", "SNA", "ANC", "BOS"];

async function main(): Promise<void> {
  const raw = await readFile(SEED_PATH, "utf-8");
  const seed = JSON.parse(raw) as SeedData;

  for (const iata of SAMPLE_IATAS) {
    const airport = seed.airports.find((a) => a.iata === iata);
    if (!airport) {
      console.log(`${iata}: NOT FOUND in seed`);
      continue;
    }
    console.log(JSON.stringify(airport, null, 2));
  }
}

main().catch((err) => {
  console.error("Failed to print sample airports:", err);
  process.exitCode = 1;
});
