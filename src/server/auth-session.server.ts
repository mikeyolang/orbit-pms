import { getRequest } from "@tanstack/react-start/server";

import { getAuth } from "./auth.server";

export async function requireUser() {
  const request = getRequest();
  if (!request) throw new Error("Unauthorized");
  const session = await getAuth().api.getSession({ headers: request.headers });
  if (!session?.user) throw new Error("Unauthorized");
  return session.user;
}
