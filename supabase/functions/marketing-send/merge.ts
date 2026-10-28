/**
 * Merge-field rendering for campaign copy.
 *
 * Three forms, deliberately no more — campaign bodies are written by people,
 * not programmers, and every extra construct is another way to put a broken
 * token in front of 200 customers:
 *
 *   {{field}}              the value, or nothing
 *   {{field|fallback}}     the value, or the fallback when the field is absent
 *   {{#if field}}…{{/if}}  the block, only when the field has a usable value
 *
 * "Absent" means null, undefined, "", false, 0 or an empty array. Zero counts
 * as absent on purpose: a customer with no blinds on file should read as
 * nothing at all, never as "0 blinds".
 */

export type MergeValues = Record<string, unknown>

const usable = (v: unknown): boolean =>
  v !== null && v !== undefined && v !== false && v !== '' && v !== 0 &&
  !(Array.isArray(v) && v.length === 0)

const IF_BLOCK = /\{\{#if\s+([a-z0-9_]+)\s*\}\}([\s\S]*?)\{\{\/if\}\}/gi
const TOKEN    = /\{\{\s*([a-z0-9_]+)\s*(?:\|([^}]*))?\}\}/gi

export function merge(template: string | null | undefined, values: MergeValues): string {
  if (!template) return ''

  // Conditionals first — the block a conditional guards almost always
  // contains tokens of its own.
  let out = String(template).replace(IF_BLOCK, (_m, key: string, block: string) =>
    usable(values[key]) ? block : '')

  out = out.replace(TOKEN, (_m, key: string, fallback?: string) =>
    usable(values[key]) ? String(values[key]) : (fallback ?? '').trim())

  // A dropped conditional leaves its surrounding blank lines behind.
  return out.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

/**
 * True if any {{…}} survived the merge.
 *
 * The caller treats this as fatal for that recipient. A typo'd field name is
 * the one template error that is invisible in review and glaring in an inbox,
 * so it has to stop the send rather than ride along inside it.
 */
export function hasUnresolved(s: string): boolean {
  return /\{\{|\}\}/.test(s)
}
