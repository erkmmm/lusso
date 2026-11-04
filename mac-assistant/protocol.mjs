export const ORIGINS = new Set(['https://app.lusso.com.au', 'http://localhost:5173', 'http://127.0.0.1:5173']);
export const RUN_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    status: { type: 'string', enum: ['completed', 'needs_input', 'failed'] },
    summary: { type: 'string' },
    questions: { type: 'array', items: { type: 'string' } },
    draftQuoteUrl: { type: ['string', 'null'] },
    supplierReference: { type: ['string', 'null'] },
    totalIncGst: { type: ['number', 'null'] },
    warnings: { type: 'array', items: { type: 'string' } },
  }, required: ['status', 'summary', 'questions', 'draftQuoteUrl', 'supplierReference', 'totalIncGst', 'warnings'],
};
export function validId(value) { return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(value); }
export function validateResult(result) {
  if (!result || !['completed', 'needs_input', 'failed'].includes(result.status)) throw new Error('The browser assistant did not return a verified outcome.');
  if (typeof result.summary !== 'string' || !Array.isArray(result.questions) || !Array.isArray(result.warnings)) throw new Error('The browser assistant returned an incomplete result.');
  if (result.draftQuoteUrl && !/^https:\/\/app\.lusso\.com\.au\/quotes\/[a-zA-Z0-9-]+(?:\/edit)?$/.test(result.draftQuoteUrl)) throw new Error('The returned draft link is not a Lusso quote.');
  if (result.status === 'completed' && (!result.draftQuoteUrl || !result.supplierReference || !Number.isFinite(result.totalIncGst) || result.totalIncGst <= 0)) throw new Error('The assistant has not verified a priced draft and supplier reference.');
  return result;
}
export function publicRun(run) {
  const { id, jobId, sheetId, userId, status, summary, questions, warnings, draftQuoteUrl, supplierReference, totalIncGst, startedAt, updatedAt, events } = run;
  return { id, jobId, sheetId, userId, status, summary, questions, warnings, draftQuoteUrl, supplierReference, totalIncGst, startedAt, updatedAt, events };
}

// Continue only with the exact sheet version the user reviewed or just saved.
export function sameSheetVersion(expected, actual) {
  const value = Date.parse(expected);
  return Number.isFinite(value) && value === Date.parse(actual);
}
