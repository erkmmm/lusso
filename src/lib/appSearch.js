export function searchAppRecords({customers=[],jobs=[],quotes=[]}, query) {
  const words=String(query || '').toLowerCase().trim().split(/\s+/).filter(Boolean);
  if(!words.length)return [];
  const customerById=new Map(customers.map(c=>[c.id,c]));
  const jobById=new Map(jobs.filter(j=>!j.deletedAt).map(j=>[j.id,j]));
  const matches=values=>words.every(word=>values.filter(Boolean).join(' ').toLowerCase().includes(word));
  const customerFields=c=>[c?.name,c?.businessName,c?.email,c?.phone,c?.mobile,c?.address,c?.billingAddress];
  const projects=jobs.filter(j=>!j.deletedAt && matches([j.jobNumber,j.title,j.siteAddress,...customerFields(customerById.get(j.customerId))]))
    .map(j=>({key:`job:${j.id}`,label:customerById.get(j.customerId)?.name || j.title || 'Project',meta:`${j.jobNumber || 'Project'} · ${j.status || ''}`,to:`/jobs/${j.id}`,kind:'Project'}));
  const quoteResults=quotes.filter(q=>!q.deletedAt && jobById.has(q.jobId) && matches([q.quoteNumber,q.title,jobById.get(q.jobId)?.jobNumber,...customerFields(customerById.get(q.customerId))]))
    .map(q=>({key:`quote:${q.id}`,label:q.quoteNumber || q.title || 'Quote',meta:`${customerById.get(q.customerId)?.name || ''} · ${q.status || ''}`,to:`/jobs/${q.jobId}?section=quote&quote=${encodeURIComponent(q.id)}&mode=review`,kind:'Quote'}));
  const contacts=customers.filter(c=>!c.deletedAt && matches(customerFields(c)))
    .map(c=>({key:`customer:${c.id}`,label:c.name || 'Customer',meta:c.businessName || c.address || c.email || '',to:`/customers/${c.id}`,kind:'Customer'}));
  return [...projects,...quoteResults,...contacts].slice(0,30);
}
