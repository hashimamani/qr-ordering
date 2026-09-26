import { describe, it, expect } from 'vitest';
import { toCsv } from './csv';

describe('toCsv', () => {
  it('prepends a UTF-8 BOM', () => {
    expect(toCsv(['a'], [['1']])).toMatch(/^﻿/);
  });

  it('uses CRLF line endings', () => {
    const csv = toCsv(['a', 'b'], [['1', '2']]);
    expect(csv).toContain('a,b\r\n1,2\r\n');
  });

  it('quotes a cell containing a comma', () => {
    expect(toCsv(['name'], [['Rice, Beans']])).toContain('"Rice, Beans"');
  });

  it('quotes and escapes a cell containing a double quote', () => {
    expect(toCsv(['name'], [['12" Pizza']])).toContain('"12"" Pizza"');
  });

  it('quotes a cell containing a newline', () => {
    expect(toCsv(['name'], [['line1\nline2']])).toContain('"line1\nline2"');
  });

  it('prefixes a formula-like cell with a single quote', () => {
    const csv = toCsv(['name'], [['=CMD(1)']]);
    expect(csv).toContain("'=CMD(1)");
  });

  it('leaves an ordinary cell untouched', () => {
    expect(toCsv(['name'], [['Tusker Lager']])).toContain('Tusker Lager');
  });

  it('renders null as an empty cell', () => {
    expect(toCsv(['name'], [[null]])).toContain('name\r\n\r\n');
  });
});
