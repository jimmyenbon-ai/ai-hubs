const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

/**
 * Parse uploaded document file into prompt items
 * @param {string} filePath - path to temp file
 * @param {string} mimeType - MIME type of file
 * @param {string} originalName - original filename
 * @returns {{ name: string, items: Array<{index: number, prompt: string, model: string|null, aspectRatio: string|null, imageSize: string|null}> }}
 */
function parseDocument(filePath, mimeType, originalName) {
  const ext = path.extname(originalName || filePath).toLowerCase();
  const baseName = path.basename(originalName || filePath, ext);

  switch (ext) {
    case '.txt':
      return parseTxt(filePath, baseName);
    case '.md':
      return parseMarkdown(filePath, baseName);
    case '.csv':
      return parseCsv(filePath, baseName);
    case '.xlsx':
    case '.xls':
      return parseXlsx(filePath, baseName);
    default:
      // fallback: try as txt
      return parseTxt(filePath, baseName);
  }
}

/**
 * Parse .txt: blank-line-separated paragraphs, strip leading number prefixes
 */
function parseTxt(filePath, baseName) {
  const content = fs.readFileSync(filePath, 'utf8');
  // normalize line endings
  const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  // split by blank lines
  const blocks = normalized.split(/\n\s*\n/);
  const items = [];

  for (const block of blocks) {
    let text = block.trim();
    if (!text) continue;
    // merge multi-line blocks into single prompt
    text = text.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
    // strip leading number prefix like "1.", "1)", "1、", "1 ", "#1", etc.
    text = text.replace(/^(#?\d+[\.\)\、\s]+\s*)/, '').trim();
    if (text) {
      items.push({ prompt: text, model: null, aspectRatio: null, imageSize: null });
    }
  }

  return { name: baseName, items: items.map((it, i) => ({ ...it, index: i + 1 })) };
}

/**
 * Parse .md: ## headings become task names, content beneath becomes prompt
 */
function parseMarkdown(filePath, baseName) {
  const content = fs.readFileSync(filePath, 'utf8');
  const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalized.split('\n');
  const items = [];
  let currentPrompt = '';
  let taskName = baseName;

  for (const line of lines) {
    // ## heading starts a new item
    if (/^##\s+/.test(line)) {
      // flush previous
      if (currentPrompt.trim()) {
        items.push({ prompt: currentPrompt.trim().replace(/\s+/g, ' '), model: null, aspectRatio: null, imageSize: null });
      }
      taskName = line.replace(/^##\s+/, '').trim();
      currentPrompt = '';
    } else {
      const trimmed = line.trim();
      if (trimmed) {
        currentPrompt += (currentPrompt ? ' ' : '') + trimmed;
      }
    }
  }

  // flush last
  if (currentPrompt.trim()) {
    items.push({ prompt: currentPrompt.trim().replace(/\s+/g, ' '), model: null, aspectRatio: null, imageSize: null });
  }

  if (items.length === 0 && taskName !== baseName) {
    items.push({ prompt: taskName, model: null, aspectRatio: null, imageSize: null });
  }

  return { name: taskName || baseName, items: items.map((it, i) => ({ ...it, index: i + 1 })) };
}

/**
 * Parse .csv: column 1 = prompt, column 2 = model (optional), column 3 = aspectRatio (optional)
 */
function parseCsv(filePath, baseName) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(l => l.trim());
  const items = [];

  // detect if first line is header
  let startIdx = 0;
  const firstLine = lines[0] || '';
  const firstCol = firstLine.split(',')[0].trim().toLowerCase();
  if (firstCol === 'prompt' || firstCol === '提示词' || firstCol === 'prompt/提示词') {
    startIdx = 1;
  }

  for (let i = startIdx; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    const prompt = (cols[0] || '').trim();
    if (!prompt) continue;
    items.push({
      prompt,
      model: (cols[1] || '').trim() || null,
      aspectRatio: (cols[2] || '').trim() || null,
      imageSize: (cols[3] || '').trim() || null,
    });
  }

  return { name: baseName, items: items.map((it, idx) => ({ ...it, index: idx + 1 })) };
}

/**
 * Parse .xlsx: first sheet, same column layout as CSV
 */
function parseXlsx(filePath, baseName) {
  const workbook = XLSX.readFile(filePath);
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!firstSheet) {
    return { name: baseName, items: [] };
  }

  const rows = XLSX.utils.sheet_to_json(firstSheet, { header: 1, defval: '' });
  if (!rows.length) {
    return { name: baseName, items: [] };
  }

  const items = [];
  let startIdx = 0;
  const firstCell = String(rows[0][0] || '').trim().toLowerCase();
  if (firstCell === 'prompt' || firstCell === '提示词' || firstCell === 'prompt/提示词') {
    startIdx = 1;
  }

  for (let i = startIdx; i < rows.length; i++) {
    const row = rows[i];
    const prompt = String(row[0] || '').trim();
    if (!prompt) continue;
    items.push({
      prompt,
      model: String(row[1] || '').trim() || null,
      aspectRatio: String(row[2] || '').trim() || null,
      imageSize: String(row[3] || '').trim() || null,
    });
  }

  return { name: baseName, items: items.map((it, idx) => ({ ...it, index: idx + 1 })) };
}

/**
 * Simple CSV line parser that handles quoted fields
 */
function parseCsvLine(line) {
  const cols = [];
  let current = '';
  let inQuotes = false;

  for (const ch of line) {
    if (inQuotes) {
      if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        cols.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
  }
  cols.push(current);
  return cols;
}

module.exports = { parseDocument };
