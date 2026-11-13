// Plain Node worker. No runtime transpiler; edit this file directly.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_worker_threads_1 = require("node:worker_threads");
const XLSX = require("xlsx");
const fflate_1 = require("fflate");
const saxes_1 = require("saxes");
const text_runtime_cjs_1 = require("../../../../tala-core/src/roster/text-runtime.cjs");
const MAX_EXPANDED = 20 * 1024 * 1024;
function docx(bytes) {
    let total = 0, entries = 0;
    const archive = (0, fflate_1.unzipSync)(bytes, { filter: file => {
            total += file.originalSize;
            entries++;
            if (total > MAX_EXPANDED || entries > 1000)
                throw new Error('archive limit');
            return file.name === 'word/document.xml';
        } });
    const document = archive['word/document.xml'];
    if (!document)
        throw new Error('no document');
    const rows = [];
    let row = [], cell = '', paragraph = '', tableDepth = 0, inText = false;
    const parser = new saxes_1.SaxesParser({ xmlns: true });
    parser.on('doctype', () => { throw new Error('doctype disallowed'); });
    parser.on('opentag', tag => {
        const local = tag.local;
        if (local === 'tbl') {
            if (++tableDepth > 1)
                throw new Error('nested table');
        }
        if (local === 'tr')
            row = [];
        if (local === 'tc')
            cell = '';
        if (local === 'p')
            paragraph = '';
        if (local === 't')
            inText = true;
        if (local === 'tab')
            paragraph += '\t';
        if (local === 'br')
            paragraph += '\n';
    });
    parser.on('text', text => { if (inText)
        paragraph += text; });
    parser.on('closetag', tag => {
        if (tag.local === 't')
            inText = false;
        if (tag.local === 'p') {
            if (tableDepth)
                cell += (cell ? '\n' : '') + paragraph;
            else if (paragraph.trim())
                rows.push([paragraph]);
        }
        if (tag.local === 'tc')
            row.push(cell);
        if (tag.local === 'tr')
            rows.push(row);
        if (tag.local === 'tbl')
            tableDepth--;
        if (rows.length > 1000 || cell.length > 10000 || paragraph.length > 10000)
            throw new Error('document limit');
    });
    parser.write((0, fflate_1.strFromU8)(document)).close();
    return rows;
}
function read(input) {
    const bytes = new Uint8Array(input.bytes);
    const ext = input.extension;
    if (['txt', 'csv', 'tsv'].includes(ext)) {
        const decoded = (0, text_runtime_cjs_1.decodeText)(bytes);
        const rows = input.exactlyAsWritten ? decoded.text.split(/\r\n?|\n/).map(s => [s]) : (0, text_runtime_cjs_1.extractText)(decoded.text, ext);
        return { rows, sheets: [], encodingReview: decoded.needsReview };
    }
    if (ext === 'docx')
        return { rows: docx(bytes), sheets: [], encodingReview: false };
    // Check ZIP expansion metadata before the spreadsheet parser touches compressed XML.
    if (bytes[0] === 80 && bytes[1] === 75) {
        let total = 0, count = 0;
        (0, fflate_1.unzipSync)(bytes, { filter: f => { total += f.originalSize; if (++count > 1000 || total > MAX_EXPANDED)
                throw new Error('archive limit'); return false; } });
    }
    const workbook = XLSX.read(bytes, { type: 'array', cellFormula: true, cellHTML: false, cellStyles: false, bookVBA: false, bookDeps: false, sheetRows: input.maxRows + 2, dense: false });
    const sheets = workbook.SheetNames;
    if (sheets.length > 30)
        throw new Error('sheet limit');
    const selected = input.sheet ?? sheets.find(s => workbook.Sheets[s]?.['!ref']);
    if (!selected || !sheets.includes(selected))
        throw new Error('missing sheet');
    const sheet = workbook.Sheets[selected];
    const ref = sheet['!fullref'] ?? sheet['!ref'];
    if (!ref)
        return { rows: [], sheets, encodingReview: false };
    const range = XLSX.utils.decode_range(ref);
    if (range.e.r - range.s.r + 1 > input.maxRows || range.e.c > 99)
        throw new Error('sheet limit');
    const rows = [];
    for (let r = range.s.r; r <= range.e.r; r++) {
        const row = [];
        for (let c = 0; c <= range.e.c; c++) {
            const cell = sheet[XLSX.utils.encode_cell({ r, c })];
            // Neither calculate formulas nor trust cached formula results. External links are never fetched.
            row.push(!cell ? '' : cell.f || cell.F ? '[formula omitted]' : cell.t === 's' || cell.t === 'n' ? String(cell.v ?? '') : '');
        }
        rows.push(row);
    }
    return { rows, sheets, encodingReview: false };
}
try {
    const input = node_worker_threads_1.workerData;
    const output = read(input);
    if (output.rows.length > input.maxRows || output.rows.some(r => r.length > 100 || r.some(c => c.length > 10000)))
        throw new Error('row limit');
    node_worker_threads_1.parentPort.postMessage({ ok: true, output });
}
catch {
    node_worker_threads_1.parentPort.postMessage({ ok: false });
}
