/** Builds a minimal CSV string from an array of flat objects. */
export function toCsv<T extends object>(rows: T[], columns: (keyof T)[]): string {
  const escape = (value: unknown) => {
    const s = value === null || value === undefined ? '' : String(value);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = columns.map((c) => escape(String(c))).join(',');
  const body = rows.map((row) => columns.map((c) => escape(row[c])).join(','));
  return [header, ...body].join('\n');
}

/** Triggers a browser download of the given CSV text. */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
