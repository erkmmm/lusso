type CallerClient = {
  rpc: (name: string) => PromiseLike<{ data: unknown; error: unknown }>
}

// Run with the caller's JWT, never the service-role client. A valid login
// alone does not establish that an account is approved or still employed.
export async function hasStaffAccess(client: CallerClient, manager = false): Promise<boolean> {
  try {
    const active = await client.rpc("is_active_user")
    if (active.error || active.data !== true) return false
    const role = await client.rpc(manager ? "is_account_manager" : "is_active_employee")
    return !role.error && role.data === true
  } catch {
    return false
  }
}
