import { getConfig } from '../config';
import { logger } from '../utils/logger';
import { renderMermaidToImage } from '../services/mermaid';

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
  '\\alpha': '\u03b1',
  '\\beta': '\u03b2',
  '\\gamma': '\u03b3',
  '\\delta': '\u03b4',
  '\\epsilon': '\u03b5',
  '\\zeta': '\u03b6',
  '\\eta': '\u03b7',
  '\\theta': '\u03b8',
  '\\iota': '\u03b9',
  '\\kappa': '\u03ba',
  '\\lambda': '\u03bb',
  '\\mu': '\u03bc',
  '\\nu': '\u03bd',
  '\\xi': '\u03be',
  '\\pi': '\u03c0',
  '\\rho': '\u03c1',
  '\\sigma': '\u03c3',
  '\\tau': '\u03c4',
  '\\upsilon': '\u03c5',
  '\\phi': '\u03c6',
  '\\chi': '\u03c7',
  '\\psi': '\u03c8',
  '\\omega': '\u03c9',
  '\\Gamma': '\u0393',
  '\\Delta': '\u0394',
  '\\Theta': '\u0398',
  '\\Lambda': '\u039b',
  '\\Xi': '\u039e',
  '\\Pi': '\u03a0',
  '\\Sigma': '\u03a3',
  '\\Phi': '\u03a6',
  '\\Psi': '\u03a8',
  '\\Omega': '\u03a9',
  '\\infty': '\u221e',
  '\\pm': '\u00b1',
  '\\times': '\u00d7',
  '\\div': '\u00f7',
  '\\neq': '\u2260',
  '\\leq': '\u2264',
  '\\geq': '\u2265',
  '\\approx': '\u2248',
  '\\equiv': '\u2261',
  '\\sum': '\u2211',
  '\\prod': '\u220f',
  '\\int': '\u222b',
  '\\partial': '\u2202',
  '\\nabla': '\u2207',
  '\\sqrt': '\u221a',
  '\\forall': '\u2200',
  '\\exists': '\u2203',
  '\\in': '\u2208',
  '\\notin': '\u2209',
  '\\subset': '\u2282',
  '\\supset': '\u2283',
  '\\cup': '\u222a',
  '\\cap': '\u2229',
  '\\emptyset': '\u2205',
  '\\rightarrow': '\u2192',
  '\\leftarrow': '\u2190',
  '\\Rightarrow': '\u21d2',
  '\\Leftarrow': '\u21d0',
  '\\leftrightarrow': '\u2194',
  '\\Leftrightarrow': '\u21d4',
  '\\cdot': '\u00b7',
  '\\ldots': '\u2026',
  '\\cdots': '\u22ef',
  '\\vdots': '\u22ee',
  '\\ddots': '\u22f1',
};

// Superscript and subscript mappings
const SUPERSCRIPTS: Record<string, string> = {
  '0': '\u2070', '1': '\u00b9', '2': '\u00b2', '3': '\u00b3',
  '4': '\u2074', '5': '\u2075', '6': '\u2076', '7': '\u2077',
  '8': '\u2078', '9': '\u2079', '+': '\u207a', '-': '\u207b',
  '=': '\u207c', '(': '\u207d', ')': '\u207e', 'n': '\u207f',
  'i': '\u2071',
};

const SUBSCRIPTS: Record<string, string> = {
  '0': '\u2080', '1': '\u2081', '2': '\u2082', '3': '\u2083',
  '4': '\u2084', '5': '\u2085', '6': '\u2086', '7': '\u2087',
  '8': '\u2088', '9': '\u2089', '+': '\u208a', '-': '\u208b',
  '=': '\u208c', '(': '\u208d', ')': '\u208e',
  'a': '\u2090', 'e': '\u2091', 'o': '\u2092', 'x': '\u2093',
  'h': '\u2095', 'k': '\u2096', 'l': '\u2097', 'm': '\u2098',
  'n': '\u2099', 'p': '\u209a', 's': '\u209b', 't': '\u209c',
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
      }
    } catch (error) {
      logger.error('Failed to render mermaid diagram:', error);
      formatted = formatted.replace(`[MERMAID_PLACEHOLDER_${i}]`, '\n*[Diagram could not be rendered]*\n');
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
