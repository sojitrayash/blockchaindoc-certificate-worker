const keccak256 = require('keccak256');
const { canonicalizeCertificateData } = require('./canonicalize');

let pdfjsLibPromise = null;
async function getPdfjsLib() {
  if (!pdfjsLibPromise) {
    pdfjsLibPromise = import('pdfjs-dist/legacy/build/pdf.mjs').then((m) => m?.default ?? m);
  }
  return pdfjsLibPromise;
}

async function extractPdfTextLayerWithPdfjs(pdfBuffer, opts = {}) {
  const { maxPages = 20 } = opts;
  const pdfjsLib = await getPdfjsLib();
  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(pdfBuffer), disableWorker: true });
  const pdf = await loadingTask.promise;
  const pageCount = Math.min(pdf.numPages || 0, maxPages);
  if (!pageCount) return '';

  let out = '';
  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const textContent = await page.getTextContent({ includeMarkedContent: false, disableCombineTextItems: false });
    const items = Array.isArray(textContent?.items) ? textContent.items : [];
    const line = items.map((it) => String(it?.str || '')).filter(Boolean).join(' ');
    if (line) out += (out ? '\n' : '') + line;
  }
  return out;
}

function normalizeTextForHash(text) {
  // Strict, punctuation-sensitive normalization.
  // Stable across whitespace/layout differences, but any content change (even '.') must invalidate.
  if (!text) return '';
  let s = String(text);

  if (typeof s.normalize === 'function') {
    s = s.normalize('NFKC');
  }
  s = s.toLowerCase();

  s = s
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015]/g, '-')
    .replace(/[\u00A0\u2000-\u200B\u202F\u205F\u3000]/g, ' ')
    // Normalize OCR confusion: common characters that look similar
    .replace(/[\|\[\]\{\}\(\)]/g, ' ') // Treat brackets/pipes as separators
    .replace(/[·•]/g, '.'); // Normalize bullets to dots

  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

function tokenizeTextForHash(text) {
  const normalized = normalizeTextForHash(text);
  if (!normalized) return [];

  // Tokenize into alphanumerics AND common punctuation characters.
  // We group consecutive punctuation to allow filtering of signature lines etc.
  try {
    const re = /[\p{L}\p{N}]+|[.,\-/]+/gu;
    let tokens = normalized.match(re) || [];

    return tokens.filter((t) => {
      const lower = t.toLowerCase();

      // Ignore long lines of punctuation (signature lines, borders, decorative elements)
      // This now works because the regex groups consecutive punctuation.
      if (t.length >= 3 && /^[.,\-/]+$/.test(t)) return false;

      // STRICT MODE: Do NOT ignore single character punctuation.
      // We want to detect if a user adds a '.' or ',' to the document.
      // if (t.length === 1 && /[.,\-/]/.test(t)) return false;

      return true;
    });
  } catch {
    const re = /[a-z0-9]+|[.,\-/]+/gi;
    return (normalized.match(re) || []).filter(t => t.length < 3 || !/^[.,\-/]+$/.test(t));
  }
}

/**
 * Legacy tokenization (ignores punctuation) for backward compatibility (V3).
 */
function tokenizeTextForHashLegacy(text) {
  const normalized = normalizeTextForHash(text);
  if (!normalized) return [];
  try {
    const re = /[\p{L}\p{N}]+/gu;
    return normalized.match(re) || [];
  } catch {
    const re = /[a-z0-9]+/gi;
    return normalized.match(re) || [];
  }
}

function mergeFragmentedLetterRuns(tokens) {
  const out = [];
  const arr = Array.isArray(tokens) ? tokens : [];

  let isLetterToken = (t) => /^[a-z]+$/.test(t);
  try {
    const re = /^\p{L}+$/u;
    isLetterToken = (t) => re.test(t);
  } catch {
    // ASCII fallback
  }

  for (let i = 0; i < arr.length; i++) {
    const t = String(arr[i] ?? '');
    if (!t) continue;

    if (isLetterToken(t) && t.length <= 2) {
      const parts = [t];
      let totalLen = t.length;
      let j = i + 1;
      while (j < arr.length) {
        const n = String(arr[j] ?? '');
        if (!n) {
          j++;
          continue;
        }
        if (!(isLetterToken(n) && n.length <= 2)) break;
        parts.push(n);
        totalLen += n.length;
        j++;
      }

      // Only merge when it's clearly a fragmented word.
      // Reduced thresholds slightly to catch more fragmented names/titles.
      if ((parts.length >= 3 && totalLen >= 4) || (parts.length >= 2 && totalLen >= 5)) {
        out.push(parts.join(''));
        i = j - 1;
        continue;
      }
    }

    out.push(t);
  }

  return out;
}

function buildTokenCounts(tokens) {
  const counts = Object.create(null);
  for (const t of tokens || []) {
    const tok = String(t);
    if (!tok) continue;
    counts[tok] = (counts[tok] || 0) + 1;
  }
  return counts;
}

function buildCanonicalPayloadFromText(text) {
  const tokens = mergeFragmentedLetterRuns(tokenizeTextForHash(text));
  return {
    v: 4,
    counts: buildTokenCounts(tokens),
    tokenCount: tokens.length,
  };
}

function buildCanonicalPayloadFromTextV3(text) {
  const tokens = tokenizeTextForHashLegacy(text);
  return {
    v: 3,
    counts: buildTokenCounts(tokens),
    tokenCount: tokens.length,
  };
}

/**
 * Compute deterministic content hash for a PDF.
 * Issuance-side: we only use the PDF's text layer (no OCR) to keep it fast.
 *
 * @param {Buffer} pdfBuffer
 * @returns {Promise<{ dataHash: string, canonical: string, tokenCount: number }|null>}
 */
async function computePdfDataHashFromTextLayer(pdfBuffer) {
  if (!pdfBuffer || !pdfBuffer.length) return null;

  const text = await extractPdfTextLayerWithPdfjs(pdfBuffer, { maxPages: 20 });

  const payload = buildCanonicalPayloadFromText(text);
  const canonical = canonicalizeCertificateData(payload, '1.0');
  const dataHash = keccak256(Buffer.from(canonical, 'utf8')).toString('hex');

  return { dataHash, canonical, tokenCount: payload.tokenCount };
}

module.exports = {
  computePdfDataHashFromTextLayer,
  normalizeTextForHash,
  buildCanonicalPayloadFromText,
  buildCanonicalPayloadFromTextV3,
  tokenizeTextForHash,
};
