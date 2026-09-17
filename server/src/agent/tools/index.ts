import type { StructuredToolInterface } from "@langchain/core/tools";
import { compareAirportsTool } from "./compareAirports.js";
import { demandPressureTool } from "./demandPressure.js";
import { explainMethodologyTool } from "./explainMethodology.js";
import { flightMixTool } from "./flightMix.js";
import { rankAirportsTool } from "./rankAirports.js";
import { resolveAirportsTool } from "./resolveAirports.js";

export const tools: StructuredToolInterface[] = [
  resolveAirportsTool,
  rankAirportsTool,
  compareAirportsTool,
  flightMixTool,
  demandPressureTool,
  explainMethodologyTool
];

export {
  compareAirportsTool,
  demandPressureTool,
  explainMethodologyTool,
  flightMixTool,
  rankAirportsTool,
  resolveAirportsTool
};
