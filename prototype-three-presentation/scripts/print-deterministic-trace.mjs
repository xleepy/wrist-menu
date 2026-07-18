import { generateTraceEvidence } from "./trace-scenarios.mjs";

process.stdout.write(`${JSON.stringify(generateTraceEvidence(), null, 2)}\n`);
