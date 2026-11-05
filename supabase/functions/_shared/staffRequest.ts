import { createClient } from "jsr:@supabase/supabase-js@2"
import { hasStaffAccess } from "./staffAccess.ts"

// For handlers that do not otherwise need a caller-scoped database client.
export async function requireStaff(
  req: Request,
  cors: Record<string, string>,
  manager = false,
): Promise<Response | null> {
  const deny = (status: number) => new Response(JSON.stringify({
    error: status === 401 ? "Unauthorized" : "Active staff access required",
  }), { status, headers: { ...cors, "Content-Type": "application/json" } })
  const auth = req.headers.get("Authorization")
  if (!auth || !/^Bearer\s+\S+$/i.test(auth)) return deny(401)
  try {
    const client = createClient(
      Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: auth } } },
    )
    const { data: { user }, error } = await client.auth.getUser()
    if (error || !user) return deny(401)
    return await hasStaffAccess(client, manager) ? null : deny(403)
  } catch {
    return deny(403)
  }
}
