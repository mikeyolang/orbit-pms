import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";

import { requireServerConfig } from "@/lib/config.server";
import { sendTransactionalEmail } from "./mail/mailgun.server";
import { getDb } from "./db/client.server";
import * as schema from "./db/schema";

let authInstance: ReturnType<typeof betterAuth> | undefined;

export function getAuth() {
  if (authInstance) return authInstance;
  const { authSecret, appUrl, trustedOrigins } = requireServerConfig("authSecret");
  authInstance = betterAuth({
    secret: authSecret,
    baseURL: appUrl,
    database: drizzleAdapter(getDb(), { provider: "pg", schema }),
    advanced: { database: { generateId: "uuid" } },
    rateLimit: { enabled: true, window: 60, max: 100 },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      sendResetPassword: async ({ user, url }) => {
        await sendTransactionalEmail({
          kind: "password-reset",
          to: user.email,
          subject: "Reset your Orbit password",
          text: `Reset your password: ${url}`,
          html: `<p>Reset your Orbit password:</p><p><a href="${url}">Reset password</a></p>`,
        });
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => {
        await sendTransactionalEmail({
          kind: "email-verification",
          to: user.email,
          subject: "Verify your Orbit email",
          text: `Verify your email: ${url}`,
          html: `<p>Verify your Orbit email:</p><p><a href="${url}">Verify email</a></p>`,
        });
      },
    },
    trustedOrigins: [
      appUrl,
      "http://localhost:8080",
      "http://127.0.0.1:8080",
      ...(trustedOrigins
        ?.split(",")
        .map((origin) => origin.trim())
        .filter(Boolean) ?? []),
    ],
  });
  return authInstance;
}
