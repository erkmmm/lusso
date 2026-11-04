/** Follow customer address corrections without replacing a separate project site. */
export function customerQuoteAddressUpdates(quotes, previousCustomer, nextCustomer, updatedAt) {
  if (!previousCustomer?.id || previousCustomer.id !== nextCustomer?.id
      || !Object.hasOwn(nextCustomer, 'address')) return [];
  const normalise = value => String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
  const before = normalise(previousCustomer.address);
  const after = normalise(nextCustomer.address);
  if (before === after) return [];
  return quotes.filter(quote => !quote.deletedAt && quote.customerId === nextCustomer.id
    && (!normalise(quote.siteAddress) || normalise(quote.siteAddress) === before))
    .map(quote => ({ ...quote, siteAddress: nextCustomer.address || '', updatedAt }));
}
