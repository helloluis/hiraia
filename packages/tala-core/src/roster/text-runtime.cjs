"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.decodeText = decodeText;
exports.parseDelimited = parseDelimited;
exports.extractText = extractText;
/** Pure byte decoding; no Buffer/TextDecoder dependency on React Native. Ambiguous encodings are reported. */
function decodeText(bytes) {
    let offset = 0;
    if ((bytes[0] === 255 && bytes[1] === 254) || (bytes[0] === 254 && bytes[1] === 255)) {
        const le = bytes[0] === 255;
        if (bytes.length % 2)
            throw new Error('Incomplete Unicode text. Paste the names instead.');
        let text = '';
        for (let i = 2; i < bytes.length; i += 2)
            text += String.fromCharCode(le ? bytes[i] + bytes[i + 1] * 256 : bytes[i] * 256 + bytes[i + 1]);
        if (/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(text))
            throw new Error('Incomplete Unicode text. Paste the names instead.');
        return { text, encoding: le ? 'utf-16le' : 'utf-16be', needsReview: false };
    }
    if (bytes[0] === 239 && bytes[1] === 187 && bytes[2] === 191)
        offset = 3;
    let text = '', valid = true;
    for (let i = offset; i < bytes.length;) {
        const b = bytes[i++];
        if (b < 128) {
            text += String.fromCharCode(b);
            continue;
        }
        const count = b >= 194 && b <= 223 ? 1 : b >= 224 && b <= 239 ? 2 : b >= 240 && b <= 244 ? 3 : -1;
        if (count < 0 || i + count > bytes.length) {
            valid = false;
            break;
        }
        let cp = b & (127 >> (count + 1));
        for (let j = 0; j < count; j++) {
            const c = bytes[i++];
            if ((c & 192) !== 128)
                valid = false;
            cp = (cp << 6) | (c & 63);
        }
        if (!valid || cp < [0, 128, 2048, 65536][count] || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) {
            valid = false;
            break;
        }
        text += String.fromCodePoint(cp);
    }
    if (valid) {
        if (text.includes('\0'))
            throw new Error('Unknown text encoding. Save as UTF-8 or paste the names.');
        return { text, encoding: 'utf-8', needsReview: false };
    }
    // Windows-1252/Latin-1 agree on ñ and accented Latin letters. Other legacy encodings
    // cannot be identified reliably; never silently call this a certain decoding.
    const cp1252 = '€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f\u0090‘’“”•–—˜™š›œ\u009džŸ';
    text = Array.from(bytes, b => b >= 128 && b <= 159 ? cp1252[b - 128] : String.fromCharCode(b)).join('');
    if (/[\x00-\x08\x0e-\x1f\x7f-\x9f]/.test(text))
        throw new Error('Unknown text encoding. Save as UTF-8 or paste the names.');
    return { text, encoding: 'windows-1252 (check against original)', needsReview: true };
}
function parseDelimited(text, delimiter) {
    const rows = [];
    let row = [], cell = '', quoted = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (c === '"' && (quoted || cell === '')) {
            if (quoted && text[i + 1] === '"') {
                cell += '"';
                i++;
            }
            else
                quoted = !quoted;
        }
        else if (!quoted && c === delimiter) {
            row.push(cell);
            cell = '';
        }
        else if (!quoted && (c === '\n' || c === '\r')) {
            row.push(cell);
            rows.push(row);
            row = [];
            cell = '';
            if (c === '\r' && text[i + 1] === '\n')
                i++;
        }
        else
            cell += c;
    }
    if (quoted)
        throw new Error('An unclosed quote was found. Check the file or paste the names.');
    if (cell || row.length)
        rows.push([...row, cell]);
    return rows;
}
function extractText(text, extension = 'txt') {
    const normalized = text.replace(/^\uFEFF/, '');
    if (extension === 'tsv')
        return parseDelimited(normalized, '\t');
    // A comma in a plain surname-first list is name punctuation, not a column separator.
    const commaTable = extension === 'csv' || /^(?:name|full name|name of learners?|first name|last name|surname|pangalan|apelyido|lrn|no\.?)\s*,/im.test(normalized);
    const candidates = ['\t', ';', '|', ...(commaTable ? [','] : [])];
    let best = '', score = 0;
    for (const delimiter of candidates) {
        const parsed = parseDelimited(normalized, delimiter);
        const widths = new Map();
        for (const row of parsed)
            if (row.length > 1)
                widths.set(row.length, (widths.get(row.length) ?? 0) + 1);
        const candidate = Math.max(0, ...widths.values());
        if (candidate > score) {
            score = candidate;
            best = delimiter;
        }
    }
    if (best)
        return parseDelimited(normalized, best);
    // Space-aligned lists: require at least two rows with explicit runs of 2+ spaces.
    const lines = normalized.split(/\r\n?|\n/);
    if (lines.filter(l => /\S {2,}\S/.test(l)).length >= 2)
        return lines.map(l => l.split(/ {2,}/));
    return lines.map(l => [l]);
}
