import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  baseURL:
    typeof window === "undefined"
      ? import.meta.env.VITE_APP_URL || "http://localhost:8080"
      : window.location.origin,
});

export const { signIn, signOut, signUp, useSession } = authClient;
