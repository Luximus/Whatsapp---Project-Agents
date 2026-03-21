import { env } from "./env.js";
import { buildApp } from "./app.js";

const app = buildApp();
await app.listen({ port: env.PORT, host: env.HOST });
