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
