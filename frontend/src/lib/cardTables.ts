/** Phone card layout reads each cell's column name from data-label. */
export function stampCardTables(root: ParentNode): void {
  for (const region of root.querySelectorAll('.table-cards')) {
    const headers = Array.from(region.querySelectorAll('thead th')).map((th) => {
      const explicit = th.getAttribute('aria-label');
      if (explicit !== null && explicit.trim() !== '') return explicit.trim();
      return (th.textContent ?? '').replace(/\s+/g, ' ').trim();
    });
    for (const row of region.querySelectorAll('tbody tr')) {
      const cells = row.querySelectorAll(':scope > td');
      cells.forEach((cell, index) => {
        const label = headers[index] ?? '';
        if (cell.getAttribute('data-label') !== label) {
          cell.setAttribute('data-label', label);
        }
      });
    }
  }
}
