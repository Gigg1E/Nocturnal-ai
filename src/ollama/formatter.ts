import { getConfig } from '../config';
import { logger } from '../utils/logger';
import { renderMermaidToImage, renderTableToImage } from '../services/mermaid';

export interface FormattedResponse {
  content: string;
  attachments: Array<{
    name: string;
    data: Buffer;
  }>;
  hasMore: boolean;
  continuation?: string;
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

/**
 * Main formatting function - converts AI output to Discord-friendly format
 */
export async function formatResponse(content: string): Promise<FormattedResponse> {
  const config = getConfig();
  const attachments: FormattedResponse['attachments'] = [];

  // Remove Qwen3 thinking tags if present
  let formatted = removeThinkingTags(content);

  // Convert LaTeX math to Unicode
  formatted = convertMathToUnicode(formatted);

  // Extract and render mermaid diagrams
  const { text: textWithoutMermaid, diagrams } = extractMermaidDiagrams(formatted);
  formatted = textWithoutMermaid;

  // Render mermaid diagrams to images
  for (let i = 0; i < diagrams.length; i++) {
    try {
      const imageBuffer = await renderMermaidToImage(diagrams[i]);
      if (imageBuffer) {
        attachments.push({
          name: `diagram_${i + 1}.png`,
          data: imageBuffer,
        });
        formatted = formatted.replace(`[MERMAID_PLACEHOLDER_${i}]`, `\n*See attached diagram ${i + 1}*\n`);
      } else {
        // renderMermaidToImage failed internally without throwing (its own
        // try/catch swallows the error and returns null) — without this,
        // the literal "[MERMAID_PLACEHOLDER_N]" text was left in the reply.
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
    try {
      const imageBuffer = await renderTableToImage(tables[i]);
      if (imageBuffer) {
        attachments.push({
          name: `table_${i + 1}.png`,
          data: imageBuffer,
        });
        formatted = formatted.replace(`[TABLE_PLACEHOLDER_${i}]`, `\n*See attached table ${i + 1}*\n`);
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

  // Extract all code blocks as file attachments
  const extracted = extractCodeBlocksAsFiles(formatted, attachments);
  formatted = extracted.content;

  // Clean up any remaining problematic formatting
  formatted = cleanupFormatting(formatted);

  // Return full formatted content - splitting is handled by splitIntoMessages
  return {
    content: formatted,
    attachments: extracted.attachments,
    hasMore: false,
  };
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

interface ExtractedCodeBlocks {
  content: string;
  attachments: Array<{ name: string; data: Buffer }>;
}

/**
 * Extract all code blocks as file attachments
 */
function extractCodeBlocksAsFiles(
  content: string,
  existingAttachments: Array<{ name: string; data: Buffer }>
): ExtractedCodeBlocks {
  const attachments = [...existingAttachments];
  let codeFileIndex = 1;

  const newContent = content.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    const trimmedCode = code.trim();
    if (!trimmedCode) {
      return ''; // Skip empty code blocks
    }

    // Extract as file attachment
    const extension = LANG_EXTENSIONS[lang.toLowerCase()] || 'txt';
    const fileName = `code_${codeFileIndex}.${extension}`;
    codeFileIndex++;

    attachments.push({
      name: fileName,
      data: Buffer.from(trimmedCode, 'utf-8'),
    });

    // Replace with reference to attachment
    const langLabel = lang ? ` (${lang})` : '';
    return `📎 *Code${langLabel}: ${fileName}*`;
  });

  return { content: newContent, attachments };
}

/**
 * Truncate code blocks that are still too large after extraction attempt
 * (fallback for splitIntoMessages which doesn't have attachment context)
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
 * Split a response into multiple messages if needed
 */
export async function splitIntoMessages(content: string): Promise<string[]> {
  const config = getConfig();
  const maxLength = config.bot.maxResponseLength;
  const messages: string[] = [];

  // First, handle oversized code blocks
  let processedContent = truncateOversizedCodeBlocks(content, maxLength);

  while (processedContent.length > 0) {
    if (processedContent.length <= maxLength) {
      messages.push(processedContent);
      break;
    }

    const splitPoint = findSmartSplitPoint(processedContent, maxLength);
    let chunk = processedContent.slice(0, splitPoint).trim();

    // Ensure code blocks are closed in this chunk
    const openBlocks = (chunk.match(/```/g) || []).length;
    if (openBlocks % 2 !== 0) {
      chunk += '\n```';
    }

    messages.push(chunk);
    processedContent = processedContent.slice(splitPoint).trim();

    // If next chunk starts mid-code-block, add opening
    if (processedContent.length > 0) {
      const remainingOpenBlocks = (processedContent.match(/```/g) || []).length;
      if (remainingOpenBlocks % 2 !== 0) {
        // Find the language from the unclosed block
        const langMatch = processedContent.match(/^([^`\n]*)\n/);
        if (langMatch && !langMatch[1].includes('```')) {
          processedContent = '```\n' + processedContent;
        }
      }
    }

    // Safety limit - for a use-bot, 3 messages is plenty
    if (messages.length >= 3) {
      if (processedContent.length > 0) {
        messages.push('*[Response truncated]*');
      }
      break;
    }
  }

  return messages;
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
