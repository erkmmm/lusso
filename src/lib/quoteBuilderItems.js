// Quote edits remain snapshots. Only the explicit library action creates a
// reusable product; it always gets a new id and never updates the source item.
export function libraryItemFromQuoteLine(line, { id, name, category = '', itemCode = '', productTypes = [] } = {}) {
  const itemName = String(name ?? line.customName ?? line.productNameSnapshot ?? '').trim();
  if (!itemName) throw new Error('Enter an item name.');
  const number = (value, label) => {
    if (value === '' || value == null) return null;
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) throw new Error(`${label} must be zero or greater.`);
    return n;
  };
  return {
    id, itemName, itemCode: itemCode.trim(),
    description: line.description || '',
    category: category.trim() || productTypes.find(p => p.id === line.productTypeId)?.name || 'Custom',
    supplier: line.supplier || '', unit: 'each', isActive: true,
    costPrice: number(line.unitCostPrice, 'Material cost'),
    labourCost: number(line.labourCost, 'Labour cost'),
    marginPercent: number(line.marginPercent, 'Margin'),
    // Store the reusable base price, without this quote's quantity or discounts.
    sellPrice: number(line.manualSellPrice, 'Selling price'),
    pricePerSqm: number(line.pricePerSqm, 'Price per square metre'),
    taxRate: line.taxable === false ? 0 : 10,
    gstApplicable: line.taxable !== false,
  };
}

export const duplicateLibraryName = (items, name) => items.some(item =>
  String(item.itemName || '').trim().toLocaleLowerCase() === String(name || '').trim().toLocaleLowerCase());

export function moveQuoteText(items, id, direction) {
  const result = [...items];
  const index = result.findIndex(item => item.id === id);
  if (index < 0) return result;
  const target = index + direction;
  if (target >= 0 && target < result.length) [result[index], result[target]] = [result[target], result[index]];
  return result;
}

// Move complete visual groups (rooms or openings), keeping alternatives together.
// Renumber the resulting lines because room rendering reads sortOrder first.
export function swapQuoteGroups(lines, firstIds, secondIds) {
  if (!firstIds?.length || !secondIds?.length) return lines;
  const first = new Set(firstIds), second = new Set(secondIds);
  if (firstIds.some(id => second.has(id))) return lines;
  const ordered = [...lines].sort((a, b) => (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0));
  const a = ordered.filter(line => first.has(line.id));
  const b = ordered.filter(line => second.has(line.id));
  if (!a.length || !b.length) return lines;
  let placedA = false, placedB = false;
  return ordered.flatMap(line => {
    if (first.has(line.id)) { if (placedB) return []; placedB = true; return b; }
    if (second.has(line.id)) { if (placedA) return []; placedA = true; return a; }
    return [line];
  }).map((line, sortOrder) => ({ ...line, sortOrder }));
}
