import { chromium, Browser, Page } from 'playwright';
import { logger } from '../utils/logger';

let browser: Browser | null = null;

/**
 * Initialize the browser instance for mermaid rendering
 */
async function getBrowser(): Promise<Browser> {
  if (!browser) {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    logger.info('Playwright browser initialized for mermaid rendering');
  }
  return browser;
}

/**
 * Close the browser instance
 */
export async function closeBrowser(): Promise<void> {
  if (browser) {
    await browser.close();
    browser = null;
    logger.info('Playwright browser closed');
  }
}

/**
 * Render a mermaid diagram to a PNG image buffer
 */
export async function renderMermaidToImage(mermaidCode: string): Promise<Buffer | null> {
  let page: Page | null = null;

  try {
    const browserInstance = await getBrowser();
    page = await browserInstance.newPage();

    // Set viewport for consistent rendering
    await page.setViewportSize({ width: 1200, height: 800 });

    // Create HTML with mermaid diagram
    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>
  <style>
    body {
      background: #2f3136;
      margin: 0;
      padding: 20px;
      display: flex;
      justify-content: center;
      align-items: flex-start;
    }
    #container {
      background: #36393f;
      padding: 20px;
      border-radius: 8px;
      display: inline-block;
    }
    .mermaid {
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
    }
  </style>
</head>
<body>
  <div id="container">
    <div class="mermaid">
${escapeHtml(mermaidCode)}
    </div>
  </div>
  <script>
    mermaid.initialize({
      startOnLoad: true,
      theme: 'dark',
      themeVariables: {
        primaryColor: '#5865F2',
        primaryTextColor: '#fff',
        primaryBorderColor: '#4752C4',
        lineColor: '#8e9297',
        secondaryColor: '#4f545c',
        tertiaryColor: '#36393f',
        background: '#36393f',
        mainBkg: '#36393f',
        textColor: '#dcddde',
        nodeBorder: '#4752C4',
        clusterBkg: '#2f3136',
        clusterBorder: '#4752C4',
        edgeLabelBackground: '#36393f',
      },
      flowchart: {
        useMaxWidth: true,
        htmlLabels: true,
        curve: 'basis'
      },
      sequence: {
        useMaxWidth: true,
        boxMargin: 10,
        boxTextMargin: 5,
        noteMargin: 10,
        messageMargin: 35
      }
    });
  </script>
</body>
</html>`;

    // Load the HTML
    await page.setContent(html, { waitUntil: 'networkidle' });

    // Wait for mermaid to render
    await page.waitForSelector('.mermaid svg', { timeout: 10000 });

    // Small delay to ensure rendering is complete
    await page.waitForTimeout(500);

    // Get the container element
    const container = await page.$('#container');
    if (!container) {
      throw new Error('Container element not found');
    }

    // Take a screenshot of just the container
    const screenshot = await container.screenshot({
      type: 'png',
      omitBackground: false,
    });

    return screenshot;
  } catch (error) {
    logger.error('Failed to render mermaid diagram:', error);
    return null;
  } finally {
    if (page) {
      await page.close();
    }
  }
}

/**
 * Render a markdown table (Discord doesn't render table syntax at all — it
 * just shows the literal pipe characters) to a PNG image, reusing the same
 * browser instance and dark theme as mermaid diagrams above.
 */
export async function renderTableToImage(markdownTable: string): Promise<Buffer | null> {
  let page: Page | null = null;

  try {
    const { headers, rows } = parseMarkdownTable(markdownTable);
    if (headers.length === 0) return null;

    const browserInstance = await getBrowser();
    page = await browserInstance.newPage();
    await page.setViewportSize({ width: 1200, height: 800 });

    const headerHtml = headers.map((h) => `<th>${mdCellToHtml(h)}</th>`).join('');
    const rowsHtml = rows
      .map((row) => `<tr>${row.map((cell) => `<td>${mdCellToHtml(cell)}</td>`).join('')}</tr>`)
      .join('');

    const html = `
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  body {
    background: #2f3136;
    margin: 0;
    padding: 20px;
    display: flex;
    justify-content: center;
    align-items: flex-start;
  }
  table {
    border-collapse: collapse;
    background: #36393f;
    border-radius: 8px;
    overflow: hidden;
    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
    font-size: 15px;
    color: #dcddde;
  }
  th, td {
    padding: 10px 16px;
    text-align: left;
    border-bottom: 1px solid #40444b;
    max-width: 320px;
  }
  th {
    background: #2b2d31;
    color: #fff;
    font-weight: 600;
  }
  tr:last-child td {
    border-bottom: none;
  }
  tr:nth-child(even) td {
    background: #32353b;
  }
  strong {
    color: #fff;
  }
</style>
</head>
<body>
  <table id="rendered-table">
    <thead><tr>${headerHtml}</tr></thead>
    <tbody>${rowsHtml}</tbody>
  </table>
</body>
</html>`;

    await page.setContent(html, { waitUntil: 'networkidle' });

    const table = await page.$('#rendered-table');
    if (!table) {
      throw new Error('Table element not found');
    }

    const screenshot = await table.screenshot({ type: 'png' });
    return screenshot;
  } catch (error) {
    logger.error('Failed to render table:', error);
    return null;
  } finally {
    if (page) {
      await page.close();
    }
  }
}

/**
 * Escapes a table cell's text and converts markdown **bold** to <strong>.
 * Order matters — escape first so the bold regex only ever matches literal
 * asterisks, never anything introduced by escaping.
 */
function mdCellToHtml(cell: string): string {
  const escaped = cell
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return escaped.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}

/**
 * Parses a GitHub-flavored markdown table (header row, separator row of
 * dashes/colons, then data rows) into headers + rows. Doesn't honor column
 * alignment (:---/---:/:---:) — not worth the complexity for a Discord
 * comparison table.
 */
function parseMarkdownTable(text: string): { headers: string[]; rows: string[][] } {
  const lines = text
    .trim()
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length < 2) return { headers: [], rows: [] };

  const splitRow = (line: string): string[] =>
    line.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());

  const headers = splitRow(lines[0]);
  const dataStart = /^[\s:|-]+$/.test(lines[1]) ? 2 : 1;
  const rows = lines.slice(dataStart).map(splitRow).filter((r) => r.length > 0);

  return { headers, rows };
}

/**
 * Validate mermaid syntax before rendering
 */
export function validateMermaidSyntax(code: string): boolean {
  const validStarts = [
    'graph',
    'flowchart',
    'sequenceDiagram',
    'classDiagram',
    'stateDiagram',
    'erDiagram',
    'journey',
    'gantt',
    'pie',
    'quadrantChart',
    'requirementDiagram',
    'gitGraph',
    'mindmap',
    'timeline',
    'sankey',
  ];

  const trimmed = code.trim();
  return validStarts.some(start => trimmed.toLowerCase().startsWith(start.toLowerCase()));
}

/**
 * Escape HTML entities to prevent XSS in mermaid code
 */
function escapeHtml(text: string): string {
  const htmlEntities: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  };

  // Don't escape mermaid-specific syntax that uses these characters
  // Only escape in text content, not in syntax
  return text
    .replace(/&(?!amp;|lt;|gt;|quot;|#039;)/g, '&amp;')
    .replace(/<(?![-a-zA-Z])/g, '&lt;')
    .replace(/(?<![a-zA-Z-])>/g, '&gt;');
}

/**
 * Clean up mermaid code for safer rendering
 */
export function cleanMermaidCode(code: string): string {
  // Remove any script tags or onclick handlers
  let cleaned = code
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/on\w+\s*=/gi, '')
    .replace(/javascript:/gi, '');

  // Trim and normalize whitespace
  cleaned = cleaned.trim();

  return cleaned;
}
