import { runSystem } from "../../shared/run-system.ts";

// npm run limiter:bug -- counter-race · limiter:fix -- counter-race · limiter:all
await runSystem(new URL(".", import.meta.url), "Rate Limiter", "limiter");
