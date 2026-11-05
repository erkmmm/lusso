import { isTestQuote } from './projectWorkspace.js';

export const PROJECT_VIEWS = [
  ['', 'All projects'], ['quoting', 'Needs quoting'], ['approval', 'Awaiting approval'],
  ['ordering', 'Ready to order'], ['booking', 'Needs booking'],
];
const closed = ['Completed', 'Cancelled', 'Lost'];
export function hasInstallation(jobId, requests = [], events = []) {
  return requests.some(r => r.jobId === jobId && !['Declined', 'Cancelled'].includes(r.status))
    || events.some(e => e.jobId === jobId && e.eventType === 'install' && !['Cancelled', 'cancelled'].includes(e.status));
}
export function matchesProjectView(job, view, quotes = [], requests = [], events = []) {
  if (!view) return true;
  if (closed.includes(job.status)) return false;
  const real = quotes.filter(q => q.jobId === job.id && !q.deletedAt && !isTestQuote(q));
  const approved = real.some(q => q.status === 'Accepted');
  const delivery = ['Approved', 'Ordered', 'Received', 'Installation Booked', 'Installed', 'Rework'].includes(job.status);
  if (view === 'quoting') return !approved && !delivery && !real.some(q => ['Sent', 'Viewed', 'Waiting'].includes(q.status));
  if (view === 'approval') return !approved && !delivery && real.some(q => ['Sent', 'Viewed', 'Waiting'].includes(q.status));
  if (view === 'ordering') return job.status === 'Approved' || (approved && !delivery);
  if (view === 'booking') return (approved || ['Approved', 'Ordered', 'Received'].includes(job.status)) && !hasInstallation(job.id, requests, events);
  return true;
}

export function deliveryOverview(job, quotes, sheets, orders, requests = [], events = []) {
  const accepted = quotes.filter(q => !q.deletedAt && !isTestQuote(q) && q.status === 'Accepted')
    .sort((a,b) => Date.parse(b.acceptedAt || b.updatedAt || b.createdAt || 0) - Date.parse(a.acceptedAt || a.updatedAt || a.createdAt || 0))[0];
  // An accepted quote's explicit choices are authoritative; never reapply defaults.
  const chosen = new Set(accepted?.selectedLineItemIds || []);
  const items = (accepted?.lineItems || []).filter(l => !['Heading', 'Text'].includes(l.type)
    && (!['Optional', 'Multiple Choice'].includes(l.type) || chosen.has(l.id)));
  const issued = orders.filter(o => ['sent', 'printed', 'downloaded', 'exported'].includes(o.status));
  const coverage = new Set(issued.flatMap(o => (o.snapshot?.lineKeys || []).map(id => `${o.measureSheetId}:${id}`)));
  const lines = new Map(sheets.flatMap(s => (s.lineItems || []).map(l => [l.id, {sheetId:s.id, line:l}])));
  const approvedItems = items.map(item => {
    const sourceId = item.measureSheetLineItemId || item.sourceMeasureSheetItemId || item.openingId;
    const source = lines.get(sourceId);
    return {item, source, ordered:!!source && coverage.has(`${source.sheetId}:${sourceId}`)};
  });
  const outstanding = approvedItems.filter(l => !l.ordered);
  const received = ['Received', 'Installation Booked', 'Installed', 'Completed'].includes(job.status);
  const booked = requests.some(r => r.jobId===job.id && ['Accepted','Scheduled','Confirmed','Completed'].includes(r.status))
    || events.some(e => e.jobId===job.id && e.eventType==='install' && !['Cancelled','cancelled'].includes(e.status))
    || ['Installation Booked', 'Installed', 'Completed'].includes(job.status);
  const bookingPending = !booked && hasInstallation(job.id,requests,events);
  return {accepted, approvedItems, outstanding, issued, received, booked, bookingPending};
}

export function approvedOrderSelection(job,quotes,sheets,orders,sheetId) {
  const data=deliveryOverview(job,quotes,sheets,orders);
  if(!data.accepted || !data.approvedItems.some(r=>r.source?.sheetId===sheetId))return null;
  return {
    quoteNumber:data.accepted.quoteNumber,
    lineIds:new Set(data.outstanding.filter(r=>r.source?.sheetId===sheetId).map(r=>r.source.line.id)),
    unmatched:data.approvedItems.filter(r=>!r.source).length,
  };
}

const priority = ['installs','rework','tasks','leads','installer','ordering','booking','toquote','quotes','invoice','reviews'];
export const TODAY_ACTIONS = {installs:'Open installation',rework:'Review rework',tasks:'Open to-do',leads:'Open enquiry',installer:'Chase installer',ordering:'Review orders',booking:'Book installation',toquote:'Prepare quote',quotes:'Follow up quote',invoice:'Review invoicing',reviews:'Review request'};
export function prioritiseToday(sections) {
  return sections.flatMap(s => s.items.map((item,index) => ({...item,key:`${s.key}:${item.id}`,category:s.label,action:TODAY_ACTIONS[s.key] || 'Open',rank:(priority.indexOf(s.key) < 0 ? 99 : priority.indexOf(s.key))*2-(item.urgent?1:0),index})))
    .sort((a,b) => a.rank-b.rank || a.index-b.index);
}

export function readStartPage(userId) {
  try { return localStorage.getItem(`lusso.start-page:${userId}`) === 'today' ? 'today' : 'dashboard'; } catch { return 'dashboard'; }
}
