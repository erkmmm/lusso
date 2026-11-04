/** Drafts follow contact corrections; historical customer versions keep their saved address. */
const normalise=value=>String(value ?? '').trim().replace(/\s+/g,' ').toLowerCase();
export function customerQuoteAddressUpdates(quotes,previousCustomer,nextCustomer,updatedAt,jobs=[]){
 if(!previousCustomer?.id || previousCustomer.id!==nextCustomer?.id || !Object.hasOwn(nextCustomer,'address'))return [];
 const before=normalise(previousCustomer.address),after=normalise(nextCustomer.address);if(before===after)return [];
 return quotes.filter(q=>!q.deletedAt && q.customerId===nextCustomer.id).flatMap(q=>{
  if(String(q.status).toLowerCase()!=='draft')return !normalise(q.siteAddress) && before?[{...q,siteAddress:previousCustomer.address,updatedAt}]:[];
  if(normalise(q.siteAddress) && normalise(q.siteAddress)!==before)return [];
  const address=jobs.find(j=>j.id===q.jobId)?.siteAddress || nextCustomer.address || '';
  return normalise(q.siteAddress)===normalise(address)?[]:[{...q,siteAddress:address,updatedAt}];
 });
}
export function projectQuoteAddressUpdates(quotes,previousJob,nextJob,customer,updatedAt){
 if(!previousJob || previousJob.id!==nextJob.id || !Object.hasOwn(nextJob,'siteAddress'))return [];
 const before=previousJob.siteAddress || customer?.address || '',after=nextJob.siteAddress || customer?.address || '';
 if(normalise(before)===normalise(after))return [];
 return quotes.filter(q=>!q.deletedAt && q.jobId===nextJob.id && String(q.status).toLowerCase()==='draft' && (!normalise(q.siteAddress) || normalise(q.siteAddress)===normalise(before))).map(q=>({...q,siteAddress:after,updatedAt}));
}
