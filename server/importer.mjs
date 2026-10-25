import { parse } from 'csv-parse/sync';
import ExcelJS from 'exceljs';
import { parsePhoneNumberFromString } from 'libphonenumber-js';
import path from 'node:path';

export function normalizePhone(value, country = 'BR') {
  let raw = String(value ?? '')
    .trim()
    .replace(/^00/, '+');
  if (!raw) return null;
  const phone = parsePhoneNumberFromString(raw, country);
  if (!phone?.isValid()) return null;
  return phone.number;
}
const clean = (value) =>
  String(value ?? '')
    .replace(/\u0000/g, '')
    .trim()
    .slice(0, 10000);
const safeKey = (key) => !['__proto__', 'constructor', 'prototype'].includes(key);
export async function parseImport(buffer, filename) {
  const extension = path.extname(filename).toLowerCase();
  let matrix;
  if (extension === '.xlsx') {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const sheet = workbook.worksheets[0];
    if (!sheet) throw new Error('A planilha não possui abas.');
    if (sheet.rowCount > 20001 || sheet.columnCount > 100)
      throw new Error('Limite: 20.000 contatos e 100 colunas por importação.');
    matrix = [];
    sheet.eachRow({ includeEmpty: false }, (row) => {
      const values = [];
      for (let index = 1; index <= sheet.columnCount; index++)
        values.push(clean(row.getCell(index).text));
      matrix.push(values);
    });
  } else if (extension === '.csv') {
    const input = buffer.toString('utf8').replace(/^\uFEFF/, '');
    const firstLine = input.split(/\r?\n/)[0];
    const delimiter = firstLine.split(';').length > firstLine.split(',').length ? ';' : ',';
    matrix = parse(input, {
      delimiter,
      relax_column_count: true,
      skip_empty_lines: true,
      max_record_size: 1024 * 1024,
    });
  } else if (['.vcf', '.vcard'].includes(extension)) {
    const cards = buffer
      .toString('utf8')
      .replace(/\r?\n[ \t]/g, '')
      .split(/BEGIN:VCARD/i)
      .slice(1);
    matrix = [['nome', 'telefone', 'empresa']];
    for (const card of cards) {
      const read = (field) =>
        clean(card.match(new RegExp(`^${field}(?:;[^:]*)?:(.*)$`, 'im'))?.[1])
          .replace(/\\n/g, ' ')
          .replace(/\\,/g, ',')
          .replace(/\\;/g, ';');
      const name = read('FN') || read('N').split(';').reverse().join(' ').trim();
      for (const match of card.matchAll(/^TEL(?:;[^:]*)?:(.*)$/gim))
        matrix.push([name, clean(match[1]), read('ORG')]);
    }
  } else
    throw new Error('Use um arquivo .xlsx, .csv ou .vcf. Para .xls, salve como .xlsx primeiro.');
  if (!matrix?.length || matrix.length < 2)
    throw new Error('O arquivo está vazio ou não tem linhas de contatos.');
  if (matrix.length > 20001) throw new Error('Importe até 20.000 contatos de cada vez.');
  const headers = matrix[0].map((cell, index) => {
    const name = clean(cell) || `Coluna ${index + 1}`;
    return safeKey(name) ? name : `Coluna ${index + 1}`;
  });
  const seen = new Set();
  for (let index = 0; index < headers.length; index++) {
    const base = headers[index];
    let suffix = 2;
    while (seen.has(headers[index])) headers[index] = `${base} (${suffix++})`;
    seen.add(headers[index]);
  }
  const rows = matrix
    .slice(1)
    .map((row) => Object.fromEntries(headers.map((header, index) => [header, clean(row[index])])));
  const match = (pattern) =>
    headers.find((header) =>
      pattern.test(header.normalize('NFD').replace(/[\u0300-\u036f]/g, '')),
    ) || '';
  return {
    headers,
    rows,
    mapping: {
      phone: match(/telefone|celular|whats|phone|mobile|numero/i) || headers[0],
      name: match(/nome|name/i),
      company: match(/empresa|company|organization|organizacao/i),
    },
  };
}
export function csvEncode(matrix) {
  return (
    '\uFEFF' +
    matrix
      .map((row) =>
        row
          .map((cell) => {
            // Spreadsheet formula injection protection for names and server-returned errors.
            const raw = String(cell ?? '');
            const safe = /^[=+\-@\t\r]/.test(raw) ? "'" + raw : raw;
            return '"' + safe.replaceAll('"', '""') + '"';
          })
          .join(';'),
      )
      .join('\r\n')
  );
}
