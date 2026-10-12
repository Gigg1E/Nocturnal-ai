import { getConfig } from '../config';
import { logger } from '../utils/logger';
import { renderMermaidToImage, renderTableToImage } from '../services/mermaid';

export interface Attachment {
  name: string;
  data: Buffer;
  // 'image' attachments (rendered diagrams/tables) get wrapped in a small
  // embed (short title + the image) instead of sent bare — reads as one
  // cohesive card rather than a floating file. 'file' attachments (large
  // extracted code) aren't images, so an embed's image field doesn't apply;
  // they're sent as a plain attachment same as before.
  kind: 'image' | 'file';
  title?: string;
}

// A response is broken into an ordered sequence of text/attachment
// segments (rather than one flat string + a bag of attachments) so an
// image/file can be sent in the same Discord message as the text that
// introduces it, instead of every attachment landing bundled onto the
// final message regardless of where it was actually referenced.
export type FormattedSegment = { text: string } | { attachment: Attachment };

export interface FormattedResponse {
  segments: FormattedSegment[];
}

// A single outgoing Discord message: some text (possibly empty, if this
// message is attachment-only) plus zero or more attachments.
export interface OutgoingMessage {
  content: string;
  attachments: Attachment[];
}

// Unicode math symbol mappings for common LaTeX
const MATH_SYMBOLS: Record<string, string> = {
  '\\alpha': 'α',
  '\\beta': 'β',
  '\\gamma': 'γ',
  '\\delta': 'δ',
  '\\epsilon': 'ε',
  '\\zeta': 'ζ',
  '\\eta': 'η',
  '\\theta': 'θ',
  '\\iota': 'ι',
  '\\kappa': 'κ',
  '\\lambda': 'λ',
  '\\mu': 'μ',
  '\\nu': 'ν',
  '\\xi': 'ξ',
  '\\pi': 'π',
  '\\rho': 'ρ',
  '\\sigma': 'σ',
  '\\tau': 'τ',
  '\\upsilon': 'υ',
  '\\phi': 'φ',
  '\\chi': 'χ',
  '\\psi': 'ψ',
  '\\omega': 'ω',
  '\\Gamma': 'Γ',
  '\\Delta': 'Δ',
  '\\Theta': 'Θ',
  '\\Lambda': 'Λ',
  '\\Xi': 'Ξ',
  '\\Pi': 'Π',
  '\\Sigma': 'Σ',
  '\\Phi': 'Φ',
  '\\Psi': 'Ψ',
  '\\Omega': 'Ω',
  '\\infty': '∞',
  '\\pm': '±',
  '\\times': '×',
  '\\div': '÷',
  '\\neq': '≠',
  '\\leq': '≤',
  '\\geq': '≥',
  '\\approx': '≈',
  '\\equiv': '≡',
  '\\sum': '∑',
  '\\prod': '∏',
  '\\int': '∫',
  '\\partial': '∂',
  '\\nabla': '∇',
  '\\sqrt': '√',
  '\\forall': '∀',
  '\\exists': '∃',
  '\\in': '∈',
  '\\notin': '∉',
  '\\subset': '⊂',
  '\\supset': '⊃',
  '\\cup': '∪',
  '\\cap': '∩',
  '\\emptyset': '∅',
  '\\rightarrow': '→',
  '\\leftarrow': '←',
  '\\Rightarrow': '⇒',
  '\\Leftarrow': '⇐',
  '\\leftrightarrow': '↔',
  '\\Leftrightarrow': '⇔',
  '\\cdot': '·',
  '\\ldots': '…',
  '\\cdots': '⋯',
  '\\vdots': '⋮',
  '\\ddots': '⋱',
};

// Superscript and subscript mappings
const SUPERSCRIPTS: Record<string, string> = {
  '0': '⁰', '1': '¹', '2': '²', '3': '³',
  '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷',
  '8': '⁸', '9': '⁹', '+': '⁺', '-': '⁻',
  '=': '⁼', '(': '⁽', ')': '⁾', 'n': 'ⁿ',
  'i': 'ⁱ',
};

const SUBSCRIPTS: Record<string, string> = {
  '0': '₀', '1': '₁', '2': '₂', '3': '₃',
  '4': '₄', '5': '₅', '6': '₆', '7': '₇',
  '8': '₈', '9': '₉', '+': '₊', '-': '₋',
  '=': '₌', '(': '₍', ')': '₎',
  'a': 'ₐ', 'e': 'ₑ', 'o': 'ₒ', 'x': 'ₓ',
  'h': 'ₕ', 'k': 'ₖ', 'l': 'ₗ', 'm': 'ₘ',
  'n': 'ₙ', 'p': 'ₚ', 's': 'ₛ', 't': 'ₜ',
};

// Sentinel marker used to track where an attachment occurred within the
// text as it passes through several extraction/cleanup steps. Uses a NUL
// byte, which can't appear in normal AI text output, so it's safe to
// split on later without colliding with real content.
const SENTINEL_PREFIX = '\u0000ATTACH:';
const SENTINEL_SUFFIX = '\u0000';
const SENTINEL_SPLIT_REGEX = /\u0000ATTACH:([^\u0000]+)\u0000/;

function sentinel(id: string): string {
  return `${SENTINEL_PREFIX}${id}${SENTINEL_SUFFIX}`;
}

/**
 * Main formatting function - converts AI output to Discord-friendly format,
 * returning an ordered sequence of text/attachment segments.
 */
export async function formatResponse(content: string): Promise<FormattedResponse> {
  const attachmentMap = new Map<string, Attachment>();

  // Remove Qwen3 thinking tags if present
  let formatted = removeThinkingTags(content);

  // Convert LaTeX math to Unicode
  formatted = convertMathToUnicode(formatted);

  // Extract and render mermaid diagrams
  const { text: textWithoutMermaid, diagrams } = extractMermaidDiagrams(formatted);
  formatted = textWithoutMermaid;

  for (let i = 0; i < diagrams.length; i++) {
    const id = `diagram_${i + 1}`;
    try {
      const imageBuffer = await renderMermaidToImage(diagrams[i]);
      if (imageBuffer) {
        const title = diagrams.length > 1 ? `Diagram ${i + 1}` : 'Diagram';
        attachmentMap.set(id, { name: `${id}.png`, data: imageBuffer, kind: 'image', title });
        formatted = formatted.replace(`[MERMAID_PLACEHOLDER_${i}]`, sentinel(id));
      } else {
        // renderMermaidToImage failed internally without throwing (its own
        // try/catch swallows the error and returns null) — without this
        // fallback, the literal "[MERMAID_PLACEHOLDER_N]" text was left in
        // the reply.
        formatted = formatted.replace(`[MERMAID_PLACEHOLDER_${i}]`, '\n*[Diagram could not be rendered]*\n');
      }
    } catch (error) {
      logger.error('Failed to render mermaid diagram:', error);
      formatted = formatted.replace(`[MERMAID_PLACEHOLDER_${i}]`, '\n*[Diagram could not be rendered]*\n');
    }
  }

  // Extract and render markdown tables — Discord doesn't render table
  // syntax at all, it just shows the literal pipe characters, so anything
  // that looks like a real markdown table gets turned into an image instead.
  const { text: textWithoutTables, tables } = extractMarkdownTables(formatted);
  formatted = textWithoutTables;

  for (let i = 0; i < tables.length; i++) {
    const id = `table_${i + 1}`;
    try {
      const imageBuffer = await renderTableToImage(tables[i]);
      if (imageBuffer) {
        const title = tables.length > 1 ? `Table ${i + 1}` : 'Table';
        attachmentMap.set(id, { name: `${id}.png`, data: imageBuffer, kind: 'image', title });
        formatted = formatted.replace(`[TABLE_PLACEHOLDER_${i}]`, sentinel(id));
      } else {
        // Couldn't parse/render it — fall back to the raw markdown rather
        // than silently dropping the content.
        formatted = formatted.replace(`[TABLE_PLACEHOLDER_${i}]`, tables[i]);
      }
    } catch (error) {
      logger.error('Failed to render table:', error);
      formatted = formatted.replace(`[TABLE_PLACEHOLDER_${i}]`, tables[i]);
    }
  }

  // Extract large code blocks as file attachments. Small snippets are left
  // completely untouched — Discord renders ``` fences as syntax-highlighted
  // code directly in the message, which reads far better inline than a
  // separate downloadable file for a 5-line example.
  formatted = extractLargeCodeBlocksAsFiles(formatted, attachmentMap);

  // Clean up any remaining problematic formatting
  formatted = cleanupFormatting(formatted);

  const segments = splitOnSentinels(formatted, attachmentMap);

  return { segments };
}

/**
 * Splits formatted text on attachment sentinels into an ordered sequence
 * of text/attachment segments.
 */
function splitOnSentinels(content: string, attachmentMap: Map<string, Attachment>): FormattedSegment[] {
  const parts = content.split(SENTINEL_SPLIT_REGEX);
  const segments: FormattedSegment[] = [];

  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 0) {
      // Even indices are the text between sentinels (String.split with a
      // capturing group interleaves [text, captured, text, captured, ...]).
      if (parts[i]) segments.push({ text: parts[i] });
    } else {
      const attachment = attachmentMap.get(parts[i]);
      if (attachment) segments.push({ attachment });
    }
  }

  return segments;
}

/**
 * Remove Qwen3's <think>...</think> tags and their content
 */
function removeThinkingTags(content: string): string {
  return content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

/**
 * Convert LaTeX math notation to Unicode approximation
 */
function convertMathToUnicode(content: string): string {
  let result = content;

  // Handle inline math $...$
  result = result.replace(/\$([^$]+)\$/g, (_, math) => {
    return convertMathExpression(math);
  });

  // Handle display math $$...$$
  result = result.replace(/\$\$([^$]+)\$\$/g, (_, math) => {
    return '\n' + convertMathExpression(math) + '\n';
  });

  // Handle \[...\] display math
  result = result.replace(/\\\[([^\]]+)\\\]/g, (_, math) => {
    return '\n' + convertMathExpression(math) + '\n';
  });

  // Handle \(...\) inline math
  result = result.replace(/\\\(([^)]+)\\\)/g, (_, math) => {
    return convertMathExpression(math);
  });

  return result;
}

/**
 * Convert a single math expression to Unicode
 */
function convertMathExpression(expr: string): string {
  let result = expr;

  // Replace LaTeX symbols
  for (const [latex, unicode] of Object.entries(MATH_SYMBOLS)) {
    result = result.replace(new RegExp(latex.replace(/\\/g, '\\\\'), 'g'), unicode);
  }

  // Handle superscripts (^{...} or ^x)
  result = result.replace(/\^{([^}]+)}/g, (_, sup) => {
    return toSuperscript(sup);
  });
  result = result.replace(/\^([0-9a-z])/gi, (_, sup) => {
    return toSuperscript(sup);
  });

  // Handle subscripts (_{...} or _x)
  result = result.replace(/_{([^}]+)}/g, (_, sub) => {
    return toSubscript(sub);
  });
  result = result.replace(/_([0-9a-z])/gi, (_, sub) => {
    return toSubscript(sub);
  });

  // Handle fractions \frac{a}{b} -> a/b
  result = result.replace(/\\frac{([^}]+)}{([^}]+)}/g, '($1)/($2)');

  // Clean up remaining LaTeX commands
  result = result.replace(/\\[a-zA-Z]+/g, '');
  result = result.replace(/[{}]/g, '');

  return result.trim();
}

function toSuperscript(text: string): string {
  return text.split('').map(c => SUPERSCRIPTS[c] || c).join('');
}

function toSubscript(text: string): string {
  return text.split('').map(c => SUBSCRIPTS[c] || c).join('');
}

/**
 * Extract mermaid diagrams and replace with placeholders
 */
function extractMermaidDiagrams(content: string): { text: string; diagrams: string[] } {
  const diagrams: string[] = [];
  let text = content;

  const mermaidRegex = /```mermaid\n([\s\S]*?)```/g;
  let match;
  let index = 0;

  while ((match = mermaidRegex.exec(content)) !== null) {
    diagrams.push(match[1].trim());
    text = text.replace(match[0], `[MERMAID_PLACEHOLDER_${index}]`);
    index++;
  }

  return { text, diagrams };
}

/**
 * Extract markdown tables (header row, a `---|---` separator row, then one
 * or more data rows) and replace each with a placeholder. Line-scanned
 * rather than a single regex since tables don't have explicit start/end
 * fences the way ```mermaid blocks do.
 */
function extractMarkdownTables(content: string): { text: string; tables: string[] } {
  const isTableRow = (line: string): boolean => /^\s*\|.*\|\s*$/.test(line);
  const isSeparatorRow = (line: string): boolean =>
    /^\s*\|?[\s:|-]+\|?\s*$/.test(line) && line.includes('-');

  const lines = content.split('\n');
  const outputLines: string[] = [];
  const tables: string[] = [];
  let i = 0;

  while (i < lines.length) {
    if (isTableRow(lines[i]) && i + 1 < lines.length && isSeparatorRow(lines[i + 1])) {
      const tableLines = [lines[i], lines[i + 1]];
      let j = i + 2;
      while (j < lines.length && isTableRow(lines[j])) {
        tableLines.push(lines[j]);
        j++;
      }
      tables.push(tableLines.join('\n'));
      outputLines.push(`[TABLE_PLACEHOLDER_${tables.length - 1}]`);
      i = j;
    } else {
      outputLines.push(lines[i]);
      i++;
    }
  }

  return { text: outputLines.join('\n'), tables };
}

// Language to file extension mapping
const LANG_EXTENSIONS: Record<string, string> = {
  javascript: 'js',
  typescript: 'ts',
  python: 'py',
  ruby: 'rb',
  rust: 'rs',
  golang: 'go',
  go: 'go',
  java: 'java',
  kotlin: 'kt',
  swift: 'swift',
  csharp: 'cs',
  cs: 'cs',
  cpp: 'cpp',
  c: 'c',
  php: 'php',
  html: 'html',
  css: 'css',
  scss: 'scss',
  sass: 'sass',
  less: 'less',
  json: 'json',
  yaml: 'yaml',
  yml: 'yml',
  xml: 'xml',
  sql: 'sql',
  bash: 'sh',
  sh: 'sh',
  shell: 'sh',
  powershell: 'ps1',
  ps1: 'ps1',
  markdown: 'md',
  md: 'md',
  lua: 'lua',
  perl: 'pl',
  r: 'r',
  scala: 'scala',
  groovy: 'groovy',
  dart: 'dart',
  vue: 'vue',
  svelte: 'svelte',
  jsx: 'jsx',
  tsx: 'tsx',
};

// Code blocks at or under this size read better as an inline ``` fence
// (Discord renders those with syntax highlighting directly in the message)
// than as a separate downloadable file — only genuinely large blocks are
// worth extracting.
const CODE_EXTRACTION_MIN_LINES = 25;
const CODE_EXTRACTION_MIN_CHARS = 1000;

/**
 * Extract only large code blocks as file attachments (see thresholds
 * above); short ones are left untouched so they render inline.
 */
function extractLargeCodeBlocksAsFiles(content: string, attachmentMap: Map<string, Attachment>): string {
  let codeFileIndex = 1;

  return content.replace(/```(\w*)\n([\s\S]*?)```/g, (match, lang, code) => {
    const trimmedCode = code.trim();
    if (!trimmedCode) {
      return ''; // Skip empty code blocks
    }

    const lineCount = trimmedCode.split('\n').length;
    if (lineCount < CODE_EXTRACTION_MIN_LINES && trimmedCode.length < CODE_EXTRACTION_MIN_CHARS) {
      return match; // Small enough to stay inline — leave the fence as-is.
    }

    const extension = LANG_EXTENSIONS[lang.toLowerCase()] || 'txt';
    const id = `code_${codeFileIndex}`;
    const fileName = `${id}.${extension}`;
    codeFileIndex++;

    attachmentMap.set(id, { name: fileName, data: Buffer.from(trimmedCode, 'utf-8'), kind: 'file' });

    const langLabel = lang ? ` (${lang})` : '';
    return `📎 *Code${langLabel}: ${fileName}*\n${sentinel(id)}`;
  });
}

/**
 * Truncate code blocks that are still too large after extraction attempt
 * (fallback for chunk-splitting which doesn't have attachment context)
 */
function truncateOversizedCodeBlocks(content: string, maxLength: number): string {
  const maxCodeBlockSize = Math.floor(maxLength * 0.8);

  return content.replace(/```(\w*)\n([\s\S]*?)```/g, (match, lang, code) => {
    if (match.length <= maxCodeBlockSize) {
      return match;
    }

    // Truncate the code, keeping first part
    const truncatedCode = code.slice(0, maxCodeBlockSize - 50);
    const lastNewline = truncatedCode.lastIndexOf('\n');
    const cleanCut = lastNewline > 0 ? truncatedCode.slice(0, lastNewline) : truncatedCode;

    return '```' + lang + '\n' + cleanCut + '\n// ... truncated\n```';
  });
}

/**
 * Clean up formatting for Discord compatibility
 */
function cleanupFormatting(content: string): string {
  let result = content;

  // Ensure code blocks are properly closed
  const codeBlockCount = (result.match(/```/g) || []).length;
  if (codeBlockCount % 2 !== 0) {
    result += '\n```';
  }

  // Limit consecutive newlines to 2
  result = result.replace(/\n{3,}/g, '\n\n');

  // Remove trailing whitespace
  result = result.trim();

  return result;
}

// ==================== SMART SPLITTING ====================

interface ContentBlock {
  type: 'text' | 'code' | 'list';
  content: string;
  start: number;
  end: number;
}

/**
 * Parse content into blocks (code blocks, lists, text)
 */
function parseContentBlocks(content: string): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  let pos = 0;

  // Regex for code blocks
  const codeBlockRegex = /```[\s\S]*?```/g;
  let match;

  while ((match = codeBlockRegex.exec(content)) !== null) {
    // Add text before code block
    if (match.index > pos) {
      const textContent = content.slice(pos, match.index);
      if (textContent.trim()) {
        blocks.push({
          type: 'text',
          content: textContent,
          start: pos,
          end: match.index,
        });
      }
    }

    // Add code block
    blocks.push({
      type: 'code',
      content: match[0],
      start: match.index,
      end: match.index + match[0].length,
    });

    pos = match.index + match[0].length;
  }

  // Add remaining text
  if (pos < content.length) {
    const textContent = content.slice(pos);
    if (textContent.trim()) {
      blocks.push({
        type: 'text',
        content: textContent,
        start: pos,
        end: content.length,
      });
    }
  }

  return blocks;
}

/**
 * Find a smart split point that respects code blocks and formatting
 */
function findSmartSplitPoint(content: string, maxLength: number): number {
  const blocks = parseContentBlocks(content);

  // Find which block we're in at maxLength
  let currentLength = 0;
  let lastSafePoint = 0;

  for (const block of blocks) {
    const blockEnd = currentLength + block.content.length;

    if (blockEnd <= maxLength) {
      // Entire block fits
      lastSafePoint = blockEnd;
      currentLength = blockEnd;
    } else if (currentLength >= maxLength) {
      // Already past limit
      break;
    } else {
      // Block crosses the limit
      if (block.type === 'code') {
        // Never split code blocks - use last safe point or start of this block
        if (lastSafePoint > maxLength * 0.5) {
          return block.start;
        }
        // Code block is too big and at start - this shouldn't happen after truncation
        return maxLength;
      } else {
        // Text block - find good split within it
        const remainingSpace = maxLength - currentLength;
        const textSplitPoint = findTextSplitPoint(block.content, remainingSpace);
        return currentLength + textSplitPoint;
      }
    }
  }

  return lastSafePoint > 0 ? lastSafePoint : maxLength;
}

/**
 * Find split point within text (no code blocks)
 */
function findTextSplitPoint(text: string, maxLength: number): number {
  if (text.length <= maxLength) {
    return text.length;
  }

  // Priority order for split points
  // 1. Paragraph boundary
  const paragraphEnd = text.lastIndexOf('\n\n', maxLength);
  if (paragraphEnd > maxLength * 0.5) {
    return paragraphEnd + 2;
  }

  // 2. List item boundary (before a line starting with - or *)
  const listPattern = /\n[-*•]\s/g;
  let lastListBoundary = -1;
  let listMatch;
  while ((listMatch = listPattern.exec(text)) !== null) {
    if (listMatch.index <= maxLength && listMatch.index > lastListBoundary) {
      lastListBoundary = listMatch.index;
    }
  }
  if (lastListBoundary > maxLength * 0.5) {
    return lastListBoundary;
  }

  // 3. Sentence boundary
  const sentenceEnders = ['. ', '! ', '? ', '.\n', '!\n', '?\n'];
  let bestSentenceEnd = -1;
  for (const ender of sentenceEnders) {
    const pos = text.lastIndexOf(ender, maxLength);
    if (pos > bestSentenceEnd) {
      bestSentenceEnd = pos + ender.length;
    }
  }
  if (bestSentenceEnd > maxLength * 0.5) {
    return bestSentenceEnd;
  }

  // 4. Line boundary
  const lineEnd = text.lastIndexOf('\n', maxLength);
  if (lineEnd > maxLength * 0.4) {
    return lineEnd + 1;
  }

  // 5. Word boundary
  const wordEnd = text.lastIndexOf(' ', maxLength);
  if (wordEnd > maxLength * 0.3) {
    return wordEnd + 1;
  }

  // 6. Hard cut (shouldn't reach here normally)
  return maxLength;
}

/**
 * Splits a block of text into Discord-sized chunks. Always returns at
 * least one element (possibly '') so an attachment with no preceding text
 * still gets a message slot.
 */
function splitTextIntoChunks(text: string, maxLength: number): string[] {
  let processedContent = truncateOversizedCodeBlocks(text, maxLength);
  const chunks: string[] = [];

  if (processedContent.trim().length === 0) {
    return [''];
  }

  while (processedContent.length > 0) {
    if (processedContent.length <= maxLength) {
      chunks.push(processedContent);
      break;
    }

    const splitPoint = findSmartSplitPoint(processedContent, maxLength);
    let chunk = processedContent.slice(0, splitPoint).trim();

    // Ensure code blocks are closed in this chunk
    const openBlocks = (chunk.match(/```/g) || []).length;
    if (openBlocks % 2 !== 0) {
      chunk += '\n```';
    }

    chunks.push(chunk);
    processedContent = processedContent.slice(splitPoint).trim();

    // If next chunk starts mid-code-block, add opening
    if (processedContent.length > 0) {
      const remainingOpenBlocks = (processedContent.match(/```/g) || []).length;
      if (remainingOpenBlocks % 2 !== 0) {
        const langMatch = processedContent.match(/^([^`\n]*)\n/);
        if (langMatch && !langMatch[1].includes('```')) {
          processedContent = '```\n' + processedContent;
        }
      }
    }
  }

  return chunks;
}

// Safety cap on how many separate Discord messages one AI response can
// turn into. Higher than the old text-only cap (3) since attachments now
// legitimately need their own message slots, not just long text.
const MAX_OUTGOING_MESSAGES = 6;

/**
 * Turns formatted segments into an ordered list of Discord messages to
 * send in sequence. Each attachment is grouped together with whatever text
 * immediately preceded it (Discord has no true inline-attachment concept —
 * files/images are always a separate block from text within one message,
 * never interleaved mid-paragraph — so putting them in the *same* message
 * as their introducing text is as close to "inline" as the platform allows).
 * If that preceding text is itself too long for one message, it's split
 * into several text-only chunks first, with the attachment riding along on
 * the last one (closest to where it was actually referenced).
 */
export function buildOutgoingMessages(segments: FormattedSegment[], responseLimit?: number): OutgoingMessage[] {
  const config = getConfig();
  const requestedLimit = responseLimit ?? config.bot.maxResponseLength;
  const maxLength = Number.isFinite(requestedLimit) ? Math.max(100, Math.min(1999, Math.floor(requestedLimit))) : 1999;

  interface Group { text: string; attachment?: Attachment }
  const groups: Group[] = [];
  let currentText = '';

  for (const seg of segments) {
    if ('text' in seg) {
      currentText += seg.text;
    } else {
      groups.push({ text: currentText, attachment: seg.attachment });
      currentText = '';
    }
  }
  if (currentText.trim() || groups.length === 0) {
    groups.push({ text: currentText });
  }

  const outgoing: OutgoingMessage[] = [];

  for (const group of groups) {
    const chunks = splitTextIntoChunks(group.text, maxLength);
    for (let i = 0; i < chunks.length; i++) {
      const isLastChunkOfGroup = i === chunks.length - 1;
      outgoing.push({
        content: chunks[i],
        attachments: isLastChunkOfGroup && group.attachment ? [group.attachment] : [],
      });
    }
  }

  // Drop any part that ended up with neither text nor an attachment (e.g.
  // the AI returned genuinely empty content) — Discord rejects a message
  // with no content, no embeds, and no files, and there's nothing useful
  // to send anyway.
  const nonEmpty = outgoing.filter((part) => part.content.trim().length > 0 || part.attachments.length > 0);

  if (nonEmpty.length > MAX_OUTGOING_MESSAGES) {
    const truncated = nonEmpty.slice(0, MAX_OUTGOING_MESSAGES - 1);
    truncated.push({ content: '*[Response truncated]*', attachments: [] });
    return truncated;
  }

  return nonEmpty;
}

/**
 * Check if response requests something too long (essay detection)
 */
export function detectLongFormRequest(message: string): boolean {
  const patterns = [
    /write\s+(?:me\s+)?(?:a\s+)?(\d+)\s*word/i,
    /(\d+)\s*word\s+essay/i,
    /(\d+)\s*word\s+article/i,
    /(\d+)\s*word\s+story/i,
    /(\d+)\s*paragraph/i,
  ];

  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match) {
      const count = parseInt(match[1], 10);
      if (count > 300 || (pattern.source.includes('paragraph') && count > 2)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Generate rejection message for long-form requests
 */
export function getLongFormRejection(): string {
  return "Can't do long-form content. Ask something specific instead.";
}
