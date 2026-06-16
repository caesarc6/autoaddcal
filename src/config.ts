import { config as loadEnv } from "dotenv";

loadEnv();

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optional(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

function optionalList(name: string, fallback: string[]): string[] {
  const value = process.env[name];
  if (!value) return fallback;
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export const config = {
  port: Number(optional("PORT", "3000")),
  baseUrl: optional("BASE_URL", "http://localhost:3000"),
  sessionSecret: optional("SESSION_SECRET", "dev-secret-change-me"),
  encryptionKey: process.env.ENCRYPTION_KEY ?? "",
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID ?? "",
    clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    redirectUri:
      process.env.GOOGLE_REDIRECT_URI ?? "http://localhost:3000/auth/google/callback",
  },
  /** Four Thursday checks (ET) until WPS posts the new week. */
  thursdaySyncCrons: optionalList("THURSDAY_SYNC_CRONS", [
    "0 12 * * 4",
    "0 15 * * 4",
    "0 18 * * 4",
    "0 21 * * 4",
  ]),
  syncTimezone: optional("SYNC_TIMEZONE", "America/New_York"),
  wpsBaseUrl: "https://wps.fastretailing.com",
};

export function assertGoogleConfig(): void {
  required("GOOGLE_CLIENT_ID");
  required("GOOGLE_CLIENT_SECRET");
}

export function assertEncryptionKey(): void {
  if (!config.encryptionKey || config.encryptionKey.length !== 64) {
    throw new Error(
      "ENCRYPTION_KEY must be a 64-character hex string (32 bytes). " +
        'Generate with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
    );
  }
}
