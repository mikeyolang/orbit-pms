import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";

import { requireServerConfig } from "@/lib/config.server";
import { escapeEmailHtml, sendTransactionalEmail } from "./mail/mailgun.server";
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
        const safeUrl = escapeEmailHtml(url);
        await sendTransactionalEmail({
          kind: "password-reset",
          to: user.email,
          subject: "Reset your Orbit password",
          text: `We received a request to reset your Orbit password. Use this secure link to choose a new password: ${url}\n\nIf you did not request this, you can safely ignore this email.`,
          html: `<p style="margin:0 0 18px">We received a request to reset your Orbit password.</p><p style="margin:0 0 24px"><a href="${safeUrl}" style="display:inline-block;border-radius:8px;background:#4f46e5;color:#fff;padding:12px 20px;font-weight:700;text-decoration:none">Choose a new password</a></p><p style="margin:0 0 10px;font-size:13px;color:#6b7280">For your security, this link can only be used to reset the password for this account.</p><p style="margin:0;font-size:13px;color:#6b7280">If you did not request this, you can safely ignore this email.</p>`,
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
