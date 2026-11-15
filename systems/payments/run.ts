import { runSystem } from "../../shared/run-system.ts";

// npm run payments:bug -- double-charge · payments:fix -- double-charge · payments:all
await runSystem(new URL(".", import.meta.url), "Payments", "payments");
