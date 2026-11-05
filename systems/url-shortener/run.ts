import { runSystem } from "../../shared/run-system.ts";

// npm run shortener:bug -- id-collision · shortener:fix -- click-counter --users 200 · shortener:all
await runSystem(new URL(".", import.meta.url), "URL Shortener", "shortener");
