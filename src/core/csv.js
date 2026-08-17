import { ParseError } from './errors.js';

/**
 * RFC 4180 CSV parsing.
 *
 * Written rather than pulled in because the exports this reads are full of
 * the cases a naive `split(',')` destroys: passwords containing commas,
 * notes spanning several lines, quotes inside quoted fields. Getting one of
 * those wrong silently imports a corrupted password, which the user only
 * discovers when a login fails.
 */

/**
 * Parse CSV text into rows of fields.
 *
 * @param {string} text
 * @returns {string[][]}
 */
export function parseCsv(text) {
  if (typeof text !== 'string') {
    throw new ParseError('CSV input must be a string');
  }

  // Strip a UTF-8 BOM: Excel writes one, and it otherwise becomes part of
  // the first column's name and breaks every header lookup.
  const input = text.replace(/^\uFEFF/, '');

  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  let index = 0;

  while (index < input.length) {
    const char = input[index];

    if (quoted) {
      if (char === '"') {
        if (input[index + 1] === '"') {
          // A doubled quote is one literal quote.
          field += '"';
          index += 2;
          continue;
        }
        quoted = false;
        index += 1;
        continue;
      }
      field += char;
      index += 1;
      continue;
    }

    if (char === '"' && field === '') {
      quoted = true;
      index += 1;
      continue;
    }
    if (char === ',') {
      row.push(field);
      field = '';
      index += 1;
      continue;
    }
    if (char === '\n' || char === '\r') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      // Consume CRLF as one line ending.
      index += char === '\r' && input[index + 1] === '\n' ? 2 : 1;
      continue;
    }

    field += char;
    index += 1;
  }

  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((line) => !(line.length === 1 && line[0] === ''));
}

/**
 * Parse CSV into objects keyed by its header row.
 *
 * Headers are lower-cased and trimmed, because the same export differs in
 * capitalisation between versions of the same product.
 *
 * @param {string} text
 * @returns {Array<Record<string, string>>}
 */
export function parseCsvObjects(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) {
    return [];
  }

  const headers = rows[0].map((header) => header.trim().toLowerCase());
  return rows.slice(1).map((row) => {
    const record = {};
    headers.forEach((header, position) => {
      record[header] = row[position] ?? '';
    });
    return record;
  });
}

/**
 * Serialise rows to CSV.
 *
 * @param {string[]} headers
 * @param {Array<Array<string>>} rows
 * @returns {string}
 */
export function toCsv(headers, rows) {
  const escape = (value) => {
    const text = value === null || value === undefined ? '' : String(value);
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [headers, ...rows].map((row) => row.map(escape).join(',')).join('\r\n');
}
