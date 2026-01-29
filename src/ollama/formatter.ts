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

  // Clean up any remaining problematic formatting
  formatted = cleanupFormatting(formatted);

  // Handle message length limit
  const maxLength = config.bot.maxResponseLength;

  if (formatted.length <= maxLength) {
    return {
      content: formatted,
      attachments,
      hasMore: false,
    };
  }

  // Split at a sensible point (sentence, paragraph, or code block boundary)
  const splitPoint = findSplitPoint(formatted, maxLength);
  const firstPart = formatted.slice(0, splitPoint).trim();
  const continuation = formatted.slice(splitPoint).trim();

  return {
    content: firstPart,
    attachments,
    hasMore: continuation.length > 0,
    continuation,
  };
}

/**
 * Remove Qwen3's <think>...</think> tags and their content
 */
function removeThinkingTags(content: string): string {
  // Remove <think>...</think> blocks (Qwen3 thinking)
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

  // Match ```mermaid ... ``` blocks
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

/**
 * Find a sensible point to split long messages
 */
function findSplitPoint(content: string, maxLength: number): number {
  // Try to find a good split point before maxLength

  // First, try paragraph boundary
  const paragraphEnd = content.lastIndexOf('\n\n', maxLength);
  if (paragraphEnd > maxLength * 0.6) {
    return paragraphEnd;
  }

  // Then try sentence boundary
  const sentenceEnders = ['. ', '! ', '? ', '.\n', '!\n', '?\n'];
  let bestSentenceEnd = -1;
  for (const ender of sentenceEnders) {
    const pos = content.lastIndexOf(ender, maxLength);
    if (pos > bestSentenceEnd) {
      bestSentenceEnd = pos + ender.length - 1;
    }
  }
  if (bestSentenceEnd > maxLength * 0.6) {
    return bestSentenceEnd;
  }

  // Try line boundary
  const lineEnd = content.lastIndexOf('\n', maxLength);
  if (lineEnd > maxLength * 0.5) {
    return lineEnd;
  }

  // Try word boundary
  const wordEnd = content.lastIndexOf(' ', maxLength);
  if (wordEnd > maxLength * 0.5) {
    return wordEnd;
  }

  // Fallback to hard cut
  return maxLength;
}

/**
 * Split a response into multiple messages if needed
 */
export async function splitIntoMessages(content: string): Promise<string[]> {
  const config = getConfig();
  const maxLength = config.bot.maxResponseLength;
  const messages: string[] = [];

  let remaining = content;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      messages.push(remaining);
      break;
    }

    const splitPoint = findSplitPoint(remaining, maxLength);
    messages.push(remaining.slice(0, splitPoint).trim());
    remaining = remaining.slice(splitPoint).trim();

    // Safety limit to prevent infinite loops
    if (messages.length > 10) {
      messages.push('*[Response truncated due to length]*');
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
      // Reject if asking for more than ~300 words or 3+ paragraphs
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
  return "I can't generate lengthy content like essays or long articles due to Discord's message limits. I'm happy to help with:\n" +
    "• Answering questions\n" +
    "• Explaining concepts briefly\n" +
    "• Providing summaries\n" +
    "• Writing short snippets or examples\n\n" +
    "How can I help within these constraints?";
}
