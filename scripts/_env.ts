import { existsSync } from "node:fs";

/** Load .env.local then .env (existing variables are never overridden). */
export function loadEnv() {
  for (const file of [".env.local", ".env"]) {
    if (existsSync(file)) process.loadEnvFile(file);
  }
}

export function required(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) {
    console.error(`✗ Missing ${name}. Add it to .env (see .env.example).`);
    process.exit(1);
  }
  return v;
}
