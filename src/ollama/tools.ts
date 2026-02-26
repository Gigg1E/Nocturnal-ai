import { getConfig } from '../config';
import { logger, logToolCall } from '../utils/logger';
import { extractEntities, ExtractedEntities } from './extractor';

const TOOLS_API_HOST = process.env.TOOLS_API_HOST || 'http://localhost:3100';

// ==================== TOOL DEFINITIONS ====================

export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
  endpointUp?: boolean;   // populated after auto-probe on failure
  endpointError?: string; // probe error detail
}

export type ToolType = 'search' | 'weather' | 'time' | 'location' | 'network' | 'phone' | 'status' | 'compute' | 'crypto' | 'security';

// ==================== WEIGHT CALCULATION ====================

export interface ToolWeights {
  search: number;
  weather: number;
  time: number;
  location: number;
  network: number;
  phone: number;
  status: number;
  compute: number;
  crypto: number;
  security: number;
}

export function calculateToolWeights(message: string, aiUncertainty: boolean = false): ToolWeights {
  const config = getConfig();
  const lowerMessage = message.toLowerCase();

  const weights: ToolWeights = {
    search: config.tools.weights.search.base,
    weather: config.tools.weights.weather.base,
    time: config.tools.weights.time.base,
    location: config.tools.weights.location.base,
    network: config.tools.weights.network.base,
    phone: config.tools.weights.phone.base,
    status: config.tools.weights.status.base,
    compute: config.tools.weights.compute.base,
    crypto: config.tools.weights.crypto.base,
    security: config.tools.weights.security.base,
  };

  // Check for keyword matches and apply boosts
  for (const [tool, keywords] of Object.entries(config.tools.keywords)) {
    const toolKey = tool as ToolType;
    const hasKeyword = keywords.some((kw: string) => lowerMessage.includes(kw));

    if (hasKeyword) {
      weights[toolKey] += config.tools.weights[toolKey].keywordBoost;
    }
  }

  // Apply uncertainty boost if AI indicated it doesn't know
  if (aiUncertainty) {
    for (const tool of Object.keys(weights) as ToolType[]) {
      weights[tool] += config.tools.weights[tool].uncertaintyBoost;
    }
  }

  // Clamp values between 0 and 1
  for (const tool of Object.keys(weights) as ToolType[]) {
    weights[tool] = Math.min(1, Math.max(0, weights[tool]));
  }

  return weights;
}

export function getToolsToCall(weights: ToolWeights): ToolType[] {
  const config = getConfig();
  const toolsToCall: ToolType[] = [];

  for (const [tool, weight] of Object.entries(weights)) {
    if (weight >= config.tools.triggerThreshold) {
      toolsToCall.push(tool as ToolType);
    }
  }

  return toolsToCall;
}

// ==================== TOOL IMPLEMENTATIONS ====================

export async function searchWeb(query: string, numResults: number = 5): Promise<ToolResult> {
  const startTime = Date.now();

  try {
    const response = await fetch(`${TOOLS_API_HOST}/api/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, num_results: numResults }),
    });

    if (!response.ok) {
      throw new Error(`Search API error: ${response.status}`);
    }

    const data = await response.json();
    logToolCall('search', { query, numResults }, true, Date.now() - startTime);
    return { success: true, data };
  } catch (error) {
    logToolCall('search', { query }, false, Date.now() - startTime);
    logger.error('Search tool error:', error);
    return { success: false, error: (error as Error).message };
  }
}

export async function getWeather(location: string): Promise<ToolResult> {
  const startTime = Date.now();

  try {
    const response = await fetch(`${TOOLS_API_HOST}/api/weather/${encodeURIComponent(location)}`);

    if (!response.ok) {
      throw new Error(`Weather API error: ${response.status}`);
    }

    const data = await response.json();
    logToolCall('weather', { location }, true, Date.now() - startTime);
    return { success: true, data };
  } catch (error) {
    logToolCall('weather', { location }, false, Date.now() - startTime);
    logger.error('Weather tool error:', error);
    return { success: false, error: (error as Error).message };
  }
}

export async function getTimezone(timezone: string): Promise<ToolResult> {
  const startTime = Date.now();

  try {
    const response = await fetch(`${TOOLS_API_HOST}/api/timezone/${encodeURIComponent(timezone)}`);

    if (!response.ok) {
      throw new Error(`Timezone API error: ${response.status}`);
    }

    const data = await response.json();
    logToolCall('timezone', { timezone }, true, Date.now() - startTime);
    return { success: true, data };
  } catch (error) {
    logToolCall('timezone', { timezone }, false, Date.now() - startTime);
    logger.error('Timezone tool error:', error);
    return { success: false, error: (error as Error).message };
  }
}

export async function getCurrentTime(): Promise<ToolResult> {
  const startTime = Date.now();

  try {
    const response = await fetch(`${TOOLS_API_HOST}/api/time`);

    if (!response.ok) {
      throw new Error(`Time API error: ${response.status}`);
    }

    const data = await response.json();
    logToolCall('time', {}, true, Date.now() - startTime);
    return { success: true, data };
  } catch (error) {
    logToolCall('time', {}, false, Date.now() - startTime);
    logger.error('Time tool error:', error);
    return { success: false, error: (error as Error).message };
  }
}

export async function geocode(location: string): Promise<ToolResult> {
  const startTime = Date.now();

  try {
    const response = await fetch(`${TOOLS_API_HOST}/api/geocode/${encodeURIComponent(location)}`);

    if (!response.ok) {
      throw new Error(`Geocode API error: ${response.status}`);
    }

    const data = await response.json();
    logToolCall('geocode', { location }, true, Date.now() - startTime);
    return { success: true, data };
  } catch (error) {
    logToolCall('geocode', { location }, false, Date.now() - startTime);
    logger.error('Geocode tool error:', error);
    return { success: false, error: (error as Error).message };
  }
}

export async function reverseGeocode(lat: number, lon: number): Promise<ToolResult> {
  const startTime = Date.now();

  try {
    const response = await fetch(`${TOOLS_API_HOST}/api/reverse-geocode/${lat}/${lon}`);

    if (!response.ok) {
      throw new Error(`Reverse geocode API error: ${response.status}`);
    }

    const data = await response.json();
    logToolCall('reverse-geocode', { lat, lon }, true, Date.now() - startTime);
    return { success: true, data };
  } catch (error) {
    logToolCall('reverse-geocode', { lat, lon }, false, Date.now() - startTime);
    logger.error('Reverse geocode tool error:', error);
    return { success: false, error: (error as Error).message };
  }
}

export async function getIpInfo(ip?: string): Promise<ToolResult> {
  const startTime = Date.now();

  try {
    const url = ip ? `${TOOLS_API_HOST}/api/ip/${ip}` : `${TOOLS_API_HOST}/api/ip`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`IP API error: ${response.status}`);
    }

    const data = await response.json();
    logToolCall('ip', { ip }, true, Date.now() - startTime);
    return { success: true, data };
  } catch (error) {
    logToolCall('ip', { ip }, false, Date.now() - startTime);
    logger.error('IP tool error:', error);
    return { success: false, error: (error as Error).message };
  }
}

export async function dnsLookup(hostname: string): Promise<ToolResult> {
  const startTime = Date.now();

  try {
    const response = await fetch(`${TOOLS_API_HOST}/api/dns/${encodeURIComponent(hostname)}`);

    if (!response.ok) {
      throw new Error(`DNS API error: ${response.status}`);
    }

    const data = await response.json();
    logToolCall('dns', { hostname }, true, Date.now() - startTime);
    return { success: true, data };
  } catch (error) {
    logToolCall('dns', { hostname }, false, Date.now() - startTime);
    logger.error('DNS tool error:', error);
    return { success: false, error: (error as Error).message };
  }
}

export async function pingHost(host: string): Promise<ToolResult> {
  const startTime = Date.now();

  try {
    const response = await fetch(`${TOOLS_API_HOST}/api/ping/${encodeURIComponent(host)}`);

    if (!response.ok) {
      throw new Error(`Ping API error: ${response.status}`);
    }

    const data = await response.json();
    logToolCall('ping', { host }, true, Date.now() - startTime);
    return { success: true, data };
  } catch (error) {
    logToolCall('ping', { host }, false, Date.now() - startTime);
    logger.error('Ping tool error:', error);
    return { success: false, error: (error as Error).message };
  }
}

export async function lookupPhone(number: string): Promise<ToolResult> {
  const startTime = Date.now();

  try {
    const response = await fetch(`${TOOLS_API_HOST}/api/phone/${encodeURIComponent(number)}`);

    if (!response.ok) {
      throw new Error(`Phone API error: ${response.status}`);
    }

    const data = await response.json();
    logToolCall('phone', { number }, true, Date.now() - startTime);
    return { success: true, data };
  } catch (error) {
    logToolCall('phone', { number }, false, Date.now() - startTime);
    logger.error('Phone tool error:', error);
    return { success: false, error: (error as Error).message };
  }
}

export async function hashText(text: string, algorithm = 'sha256'): Promise<ToolResult> {
  const startTime = Date.now();
  try {
    const response = await fetch(`${TOOLS_API_HOST}/api/hash`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, algorithm }),
    });
    if (!response.ok) throw new Error(`Hash API error: ${response.status}`);
    const data = await response.json();
    logToolCall('hash', { algorithm, length: text.length }, true, Date.now() - startTime);
    return { success: true, data };
  } catch (error) {
    logToolCall('hash', { algorithm }, false, Date.now() - startTime);
    return { success: false, error: (error as Error).message };
  }
}

export async function encodeBase64(text: string, mode = 'encode'): Promise<ToolResult> {
  const startTime = Date.now();
  try {
    const response = await fetch(`${TOOLS_API_HOST}/api/base64`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, mode }),
    });
    if (!response.ok) throw new Error(`Base64 API error: ${response.status}`);
    const data = await response.json();
    logToolCall('base64', { mode }, true, Date.now() - startTime);
    return { success: true, data };
  } catch (error) {
    logToolCall('base64', { mode }, false, Date.now() - startTime);
    return { success: false, error: (error as Error).message };
  }
}

export async function calcSubnet(cidr: string): Promise<ToolResult> {
  const startTime = Date.now();
  try {
    const response = await fetch(`${TOOLS_API_HOST}/api/subnet`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cidr }),
    });
    if (!response.ok) throw new Error(`Subnet API error: ${response.status}`);
    const data = await response.json();
    logToolCall('subnet', { cidr }, true, Date.now() - startTime);
    return { success: true, data };
  } catch (error) {
    logToolCall('subnet', { cidr }, false, Date.now() - startTime);
    return { success: false, error: (error as Error).message };
  }
}

export async function whoisLookup(domain: string): Promise<ToolResult> {
  const startTime = Date.now();
  try {
    const response = await fetch(`${TOOLS_API_HOST}/api/whois/${encodeURIComponent(domain)}`);
    if (!response.ok) throw new Error(`WHOIS API error: ${response.status}`);
    const data = await response.json();
    logToolCall('whois', { domain }, true, Date.now() - startTime);
    return { success: true, data };
  } catch (error) {
    logToolCall('whois', { domain }, false, Date.now() - startTime);
    return { success: false, error: (error as Error).message };
  }
}

export async function asnLookup(ip: string): Promise<ToolResult> {
  const startTime = Date.now();
  try {
    const response = await fetch(`${TOOLS_API_HOST}/api/asn/${encodeURIComponent(ip)}`);
    if (!response.ok) throw new Error(`ASN API error: ${response.status}`);
    const data = await response.json();
    logToolCall('asn', { ip }, true, Date.now() - startTime);
    return { success: true, data };
  } catch (error) {
    logToolCall('asn', { ip }, false, Date.now() - startTime);
    return { success: false, error: (error as Error).message };
  }
}

export async function getCryptoPrice(symbol: string): Promise<ToolResult> {
  const startTime = Date.now();
  try {
    const response = await fetch(`${TOOLS_API_HOST}/api/crypto/${encodeURIComponent(symbol)}`);
    if (!response.ok) throw new Error(`Crypto API error: ${response.status}`);
    const data = await response.json();
    logToolCall('crypto', { symbol }, true, Date.now() - startTime);
    return { success: true, data };
  } catch (error) {
    logToolCall('crypto', { symbol }, false, Date.now() - startTime);
    return { success: false, error: (error as Error).message };
  }
}

export async function lookupCVE(id: string): Promise<ToolResult> {
  const startTime = Date.now();
  try {
    const response = await fetch(`${TOOLS_API_HOST}/api/cve/${encodeURIComponent(id)}`);
    if (!response.ok) throw new Error(`CVE API error: ${response.status}`);
    const data = await response.json();
    logToolCall('cve', { id }, true, Date.now() - startTime);
    return { success: true, data };
  } catch (error) {
    logToolCall('cve', { id }, false, Date.now() - startTime);
    return { success: false, error: (error as Error).message };
  }
}

export async function checkSSL(hostname: string): Promise<ToolResult> {
  const startTime = Date.now();
  try {
    const response = await fetch(`${TOOLS_API_HOST}/api/ssl/${encodeURIComponent(hostname)}`);
    if (!response.ok) throw new Error(`SSL API error: ${response.status}`);
    const data = await response.json();
    logToolCall('ssl', { hostname }, true, Date.now() - startTime);
    return { success: true, data };
  } catch (error) {
    logToolCall('ssl', { hostname }, false, Date.now() - startTime);
    return { success: false, error: (error as Error).message };
  }
}

export async function checkHttpStatus(url: string): Promise<ToolResult> {
  const startTime = Date.now();
  try {
    const response = await fetch(`${TOOLS_API_HOST}/api/http-status?url=${encodeURIComponent(url)}`);
    if (!response.ok) throw new Error(`HTTP status API error: ${response.status}`);
    const data = await response.json();
    logToolCall('http-status', { url }, true, Date.now() - startTime);
    return { success: true, data };
  } catch (error) {
    logToolCall('http-status', { url }, false, Date.now() - startTime);
    return { success: false, error: (error as Error).message };
  }
}

// ==================== TOOL EXECUTION ====================

export interface ToolContext {
  message: string;
  toolsToCall: ToolType[];
}

export async function executeTools(context: ToolContext): Promise<Map<string, ToolResult>> {
  const results = new Map<string, ToolResult>();
  const message = context.message.toLowerCase();

  // Use AI to extract entities from the message
  let entities: ExtractedEntities = {};
  try {
    entities = await extractEntities(context.message);
    logger.debug('AI extracted entities:', entities);
  } catch (error) {
    logger.warn('AI extraction failed, falling back to regex:', error);
  }

  // Filter out redundant tools
  const toolsToRun = filterRedundantTools(context.toolsToCall);

  for (const tool of toolsToRun) {
    switch (tool) {
      case 'search': {
        // Use AI-extracted search query, fall back to regex
        const searchQuery = entities.searchQuery || extractSearchQuery(context.message);
        if (searchQuery) {
          results.set('search', await searchWeb(searchQuery));
        }
        break;
      }

      case 'weather': {
        // Use AI-extracted location, fall back to regex
        const location = entities.location || extractLocation(context.message);
        if (location) {
          results.set('weather', await getWeather(location));
        }
        break;
      }

      case 'time': {
        // Use AI-extracted timezone, fall back to regex
        const timezone = entities.timezone || extractTimezone(context.message);
        if (timezone) {
          results.set('timezone', await getTimezone(timezone));
        } else {
          results.set('time', await getCurrentTime());
        }
        break;
      }

      case 'location': {
        // Check for coordinates first (regex is reliable for this)
        const coords = extractCoordinates(context.message);
        if (coords) {
          results.set('reverse-geocode', await reverseGeocode(coords.lat, coords.lon));
        } else {
          // Use AI-extracted location, fall back to regex
          const locationName = entities.location || extractLocation(context.message);
          if (locationName) {
            results.set('geocode', await geocode(locationName));
          }
        }
        break;
      }

      case 'network': {
        if (message.includes('ping')) {
          // Use AI-extracted hostname, fall back to regex
          const host = entities.hostname || extractHostname(context.message);
          if (host) {
            results.set('ping', await pingHost(host));
          }
        } else if (message.includes('dns') || message.includes('resolve')) {
          const hostname = entities.hostname || extractHostname(context.message);
          if (hostname) {
            results.set('dns', await dnsLookup(hostname));
          }
        } else if (message.includes('ip')) {
          const ip = entities.ipAddress || extractIpAddress(context.message);
          if (ip) {
            results.set('ip', await getIpInfo(ip));
          } else {
            results.set('ip', {
              success: false,
              error: "No IP address found in message. Discord bots cannot determine a user's IP — ask the user to provide a specific IP address to look up.",
            });
          }
        } else if (message.includes('whois')) {
          const domain = entities.hostname || extractHostname(context.message);
          if (domain) results.set('whois', await whoisLookup(domain));
        } else if (message.includes('ssl') || message.includes('cert')) {
          const host = entities.hostname || extractHostname(context.message);
          if (host) results.set('ssl', await checkSSL(host));
        } else if (message.includes('asn') || message.includes('autonomous system')) {
          const ip = entities.ipAddress || extractIpAddress(context.message);
          if (ip) results.set('asn', await asnLookup(ip));
        } else if (
          message.includes('http status') || message.includes('site status') ||
          message.includes('is it up') || message.includes('is it down') ||
          message.includes('is the site')
        ) {
          const url = extractUrl(context.message);
          if (url) results.set('http-status', await checkHttpStatus(url));
        }
        break;
      }

      case 'compute': {
        if (message.includes('subnet') || message.includes('cidr')) {
          const cidr = extractCIDR(context.message);
          if (cidr) results.set('subnet', await calcSubnet(cidr));
        } else if (message.includes('base64')) {
          const mode = message.includes('decode') ? 'decode' : 'encode';
          const text = entities.searchQuery || extractComputeText(context.message);
          if (text) results.set('base64', await encodeBase64(text, mode));
        } else {
          const algo = extractHashAlgorithm(context.message);
          const text = entities.searchQuery || extractComputeText(context.message);
          if (text) results.set('hash', await hashText(text, algo));
        }
        break;
      }

      case 'crypto': {
        const symbol = extractCoinSymbol(context.message) || entities.searchQuery || '';
        if (symbol) results.set('crypto', await getCryptoPrice(symbol));
        break;
      }

      case 'security': {
        const cveId = extractCVEId(context.message);
        if (cveId) results.set('cve', await lookupCVE(cveId));
        break;
      }

      case 'phone': {
        const number = entities.phoneNumber || extractPhoneNumber(context.message);
        if (number) {
          results.set('phone', await lookupPhone(number));
        }
        break;
      }

      case 'status': {
        results.set('status', await getToolStatus());
        break;
      }
    }
  }

  // Auto-probe any failed tool endpoints so the AI knows if it's a service outage
  const failedEntries = [...results.entries()].filter(([, r]) => !r.success);
  if (failedEntries.length > 0) {
    const keyToTool: Record<string, ToolType> = {
      search: 'search',
      weather: 'weather',
      time: 'time',
      timezone: 'time',
      geocode: 'location',
      'reverse-geocode': 'location',
      ip: 'network',
      dns: 'network',
      ping: 'network',
      whois: 'network',
      ssl: 'network',
      asn: 'network',
      'http-status': 'network',
      phone: 'phone',
      hash: 'compute',
      base64: 'compute',
      subnet: 'compute',
      crypto: 'crypto',
      cve: 'security',
    };
    await Promise.all(
      failedEntries.map(async ([key, result]) => {
        const tool = keyToTool[key];
        if (!tool) return;
        const health = await probeSpecificTool(tool);
        result.endpointUp = health.ok;
        result.endpointError = health.error;
      })
    );
  }

  return results;
}

// Filter out redundant tool calls
function filterRedundantTools(tools: ToolType[]): ToolType[] {
  const filtered = [...tools];

  // If weather is requested, skip location (weather already includes location data)
  if (filtered.includes('weather') && filtered.includes('location')) {
    const idx = filtered.indexOf('location');
    if (idx !== -1) {
      filtered.splice(idx, 1);
      logger.debug('Skipping location tool (redundant with weather)');
    }
  }

  return filtered;
}

// ==================== EXTRACTION HELPERS ====================

function extractSearchQuery(message: string): string | null {
  // Common patterns for search queries
  const patterns = [
    /search\s+(?:for\s+)?["']?([^"']+)["']?/i,
    /look\s+up\s+["']?([^"']+)["']?/i,
    /find\s+(?:info\s+(?:on|about)\s+)?["']?([^"']+)["']?/i,
    /what\s+is\s+["']?([^"'?]+)["']?\??/i,
    /who\s+is\s+["']?([^"'?]+)["']?\??/i,
  ];

  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match && match[1]) {
      return match[1].trim();
    }
  }

  // If no pattern matched, use the whole message as query (cleaned up)
  return message.replace(/@\S+/g, '').trim() || null;
}

function extractLocation(message: string): string | null {
  // Patterns for location extraction
  const patterns = [
    /(?:weather|temperature|forecast)\s+(?:in|for|at)\s+["']?([^"'?]+)["']?/i,
    /(?:in|at|for)\s+["']?([A-Z][a-zA-Z\s,]+)["']?/i,
  ];

  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match && match[1]) {
      return match[1].trim();
    }
  }

  return null;
}

function extractTimezone(message: string): string | null {
  // Match timezone format like America/New_York
  const pattern = /([A-Z][a-z]+\/[A-Z][a-z_]+)/;
  const match = message.match(pattern);
  return match ? match[1] : null;
}

function extractCoordinates(message: string): { lat: number; lon: number } | null {
  // Match coordinates like "40.7128, -74.0060" or "40.7128 -74.0060"
  const pattern = /(-?\d+\.?\d*)[,\s]+(-?\d+\.?\d*)/;
  const match = message.match(pattern);

  if (match) {
    const lat = parseFloat(match[1]);
    const lon = parseFloat(match[2]);
    if (!isNaN(lat) && !isNaN(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
      return { lat, lon };
    }
  }

  return null;
}

function extractHostname(message: string): string | null {
  // Match domain names or IP addresses
  const domainPattern = /(?:ping|dns|resolve|lookup)\s+["']?([a-zA-Z0-9][a-zA-Z0-9-]*(?:\.[a-zA-Z0-9][a-zA-Z0-9-]*)+)["']?/i;
  const ipPattern = /(?:ping|dns|resolve|lookup)\s+["']?(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})["']?/i;

  let match = message.match(domainPattern);
  if (match) return match[1];

  match = message.match(ipPattern);
  if (match) return match[1];

  // Try to find any domain-like string
  const anyDomain = message.match(/([a-zA-Z0-9][a-zA-Z0-9-]*(?:\.[a-zA-Z0-9][a-zA-Z0-9-]*)+)/);
  if (anyDomain) return anyDomain[1];

  return null;
}

function extractIpAddress(message: string): string | null {
  const pattern = /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/;
  const match = message.match(pattern);
  return match ? match[1] : null;
}

function extractPhoneNumber(message: string): string | null {
  // E.164 format: +14155552671
  const e164 = message.match(/(\+\d{1,3}[\d\s\-().]{6,})/);
  if (e164) return e164[1].trim();

  // Keyword-prefixed number: "phone 555-123-4567" or "number (555) 123-4567"
  const keywordPrefixed = message.match(
    /(?:phone|number|call|validate|lookup|verify)\s+(?:number\s+)?(\(?\d{3}\)?[\s\-.]?\d{3}[\s\-.]?\d{4})/i
  );
  if (keywordPrefixed) return keywordPrefixed[1].trim();

  // Bare US format: (555) 123-4567 or 555-123-4567 or 555.123.4567
  const usFormat = message.match(/(\(?\d{3}\)?[\s\-.]?\d{3}[\s\-.]?\d{4})/);
  if (usFormat) return usFormat[1].trim();

  return null;
}

function extractCIDR(message: string): string | null {
  const match = message.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\/\d{1,2})/);
  return match ? match[1] : null;
}

function extractCVEId(message: string): string | null {
  const match = message.match(/(CVE-\d{4}-\d{4,7})/i);
  return match ? match[1].toUpperCase() : null;
}

const COIN_NAME_MAP: Record<string, string> = {
  bitcoin: 'btc', ethereum: 'eth', litecoin: 'ltc', dogecoin: 'doge',
  solana: 'sol', cardano: 'ada', ripple: 'xrp', binance: 'bnb',
  polkadot: 'dot', chainlink: 'link', avalanche: 'avax', cosmos: 'atom',
  shiba: 'shib',
};

function extractCoinSymbol(message: string): string | null {
  // Direct ticker: "BTC", "ETH", etc.
  const tickerMatch = message.match(/\b(btc|eth|ltc|doge|sol|ada|xrp|bnb|matic|dot|link|avax|atom|near|shib)\b/i);
  if (tickerMatch) return tickerMatch[1].toLowerCase();
  // Coin name: "bitcoin", "ethereum", etc.
  for (const [name, ticker] of Object.entries(COIN_NAME_MAP)) {
    if (message.toLowerCase().includes(name)) return ticker;
  }
  return null;
}

function extractUrl(message: string): string | null {
  // Full URL with scheme
  const fullUrl = message.match(/https?:\/\/[^\s]+/i);
  if (fullUrl) return fullUrl[0];
  // Bare domain — common TLDs
  const bareDomain = message.match(/\b([a-zA-Z0-9][a-zA-Z0-9-]*\.(?:com|net|org|io|dev|gov|edu|co|uk|de|ca|au)(?:\/[^\s]*)?)\b/i);
  if (bareDomain) return `https://${bareDomain[1]}`;
  return null;
}

function extractComputeText(message: string): string | null {
  // Quoted text
  const quoted = message.match(/["']([^"']+)["']/);
  if (quoted) return quoted[1];
  // Text after a colon
  const afterColon = message.match(/:\s*(.+)$/);
  if (afterColon) return afterColon[1].trim();
  // Text after "of " or "encode " / "hash "
  const afterKeyword = message.match(/(?:hash|encode|decode)\s+(.+)$/i);
  if (afterKeyword) return afterKeyword[1].trim();
  return null;
}

function extractHashAlgorithm(message: string): string {
  if (message.includes('sha512')) return 'sha512';
  if (message.includes('sha256')) return 'sha256';
  if (message.includes('sha1')) return 'sha1';
  if (message.includes('md5')) return 'md5';
  return 'sha256';
}

// ==================== FORMAT TOOL RESULTS FOR AI ====================

export function formatToolResultsForAI(results: Map<string, ToolResult>): string {
  if (results.size === 0) return '';

  const parts: string[] = ['[Tool Results]'];

  for (const [tool, result] of results) {
    if (result.success) {
      parts.push(`\n${tool.toUpperCase()}:\n${JSON.stringify(result.data, null, 2)}`);
    } else {
      const fallbackMessages: Record<string, string> = {
        weather:  'Weather data temporarily unavailable. Answer from your own knowledge and note that live conditions could not be fetched.',
        search:   'Web search temporarily unavailable. Answer from your own knowledge and be transparent that you could not verify current information.',
        time:     'Time/timezone lookup temporarily unavailable. Provide your best answer and note that live data could not be retrieved.',
        location: 'Location/geocoding temporarily unavailable. Answer from your own knowledge if possible.',
        network:  'The network lookup failed. Explicitly tell the user the request could not be completed, and ask them to provide the specific IP/hostname if they did not include one.',
        phone:    'Phone number lookup temporarily unavailable. Let the user know the lookup failed.',
        compute:  'Computation tool (hash/base64/subnet) temporarily unavailable. Explicitly tell the user the operation failed.',
        crypto:   'Crypto price lookup temporarily unavailable. Let the user know the price could not be fetched.',
        security: 'CVE/security lookup temporarily unavailable. Let the user know the lookup failed.',
      };
      // Sub-tool keys → group names for fallback lookup
      const keyToGroup: Record<string, string> = {
        ip: 'network', dns: 'network', ping: 'network',
        whois: 'network', ssl: 'network', asn: 'network', 'http-status': 'network',
        timezone: 'time', geocode: 'location', 'reverse-geocode': 'location',
        hash: 'compute', base64: 'compute', subnet: 'compute',
        crypto: 'crypto', cve: 'security',
      };
      const fallbackKey = keyToGroup[tool] ?? tool;
      const fallback = fallbackMessages[fallbackKey] ?? 'Tool temporarily unavailable. Explicitly tell the user the lookup failed.';
      let healthNote = '';
      if (result.endpointUp === false) {
        healthNote = ` The endpoint is currently unreachable (${result.endpointError ?? 'no response'}) — this is likely a service outage, not a data issue.`;
      } else if (result.endpointUp === true) {
        healthNote = ' The endpoint is reachable — this may be a transient data or query error.';
      }
      parts.push(`\n${tool.toUpperCase()}: [${fallback}${healthNote}]`);
    }
  }

  return parts.join('\n');
}

// ==================== API HEALTH CHECK ====================

export async function checkToolsApiConnection(): Promise<boolean> {
  try {
    const response = await fetch(`${TOOLS_API_HOST}/health`);
    return response.ok;
  } catch {
    return false;
  }
}

export interface ToolEndpointStatus {
  ok: boolean;
  error?: string;
}

async function probeEndpoint(
  url: string,
  options?: RequestInit,
  timeoutMs = 5000
): Promise<{ ok: boolean; error?: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: ctrl.signal as RequestInit['signal'] });
    clearTimeout(timer);
    return { ok: res.ok, error: res.ok ? undefined : `HTTP ${res.status}` };
  } catch (err) {
    clearTimeout(timer);
    const msg = (err as Error).message;
    return { ok: false, error: msg.includes('abort') ? 'timed out' : msg };
  }
}

export async function checkIndividualTools(): Promise<Record<string, ToolEndpointStatus>> {
  const entries = await Promise.all([
    probeEndpoint(`${TOOLS_API_HOST}/api/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'test', num_results: 1 }),
    }).then(s => ['search', s] as const),
    probeEndpoint(`${TOOLS_API_HOST}/api/weather/London`).then(s => ['weather', s] as const),
    probeEndpoint(`${TOOLS_API_HOST}/api/time`).then(s => ['time', s] as const),
    probeEndpoint(`${TOOLS_API_HOST}/api/geocode/London`).then(s => ['location', s] as const),
    probeEndpoint(`${TOOLS_API_HOST}/api/ip/8.8.8.8`).then(s => ['network (ip)', s] as const),
    probeEndpoint(`${TOOLS_API_HOST}/api/dns/google.com`).then(s => ['network (dns)', s] as const),
    probeEndpoint(`${TOOLS_API_HOST}/api/phone/${encodeURIComponent('+12025551234')}`).then(s => ['phone', s] as const),
    probeEndpoint(`${TOOLS_API_HOST}/api/news/technology`).then(s => ['news', s] as const),
    probeEndpoint(`${TOOLS_API_HOST}/api/hash`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'probe', algorithm: 'sha256' }),
    }).then(s => ['compute (hash)', s] as const),
    probeEndpoint(`${TOOLS_API_HOST}/api/subnet`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cidr: '192.168.1.0/24' }),
    }).then(s => ['compute (subnet)', s] as const),
    probeEndpoint(`${TOOLS_API_HOST}/api/whois/google.com`).then(s => ['network (whois)', s] as const),
    probeEndpoint(`${TOOLS_API_HOST}/api/asn/8.8.8.8`).then(s => ['network (asn)', s] as const),
    probeEndpoint(`${TOOLS_API_HOST}/api/crypto/btc`).then(s => ['crypto', s] as const),
    probeEndpoint(`${TOOLS_API_HOST}/api/cve/CVE-2021-44228`).then(s => ['security (cve)', s] as const),
    probeEndpoint(`${TOOLS_API_HOST}/api/ssl/google.com`).then(s => ['network (ssl)', s] as const),
    probeEndpoint(`${TOOLS_API_HOST}/api/http-status?url=${encodeURIComponent('https://google.com')}`).then(s => ['network (http-status)', s] as const),
  ]);
  return Object.fromEntries(entries);
}

// Per-tool endpoint probes (2s timeout — used for auto-health on failure)
const TOOL_PROBES: Partial<Record<ToolType, () => Promise<ToolEndpointStatus>>> = {
  search:   () => probeEndpoint(`${TOOLS_API_HOST}/api/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: 'test', num_results: 1 }),
  }, 2000),
  weather:  () => probeEndpoint(`${TOOLS_API_HOST}/api/weather/London`, undefined, 2000),
  time:     () => probeEndpoint(`${TOOLS_API_HOST}/api/time`, undefined, 2000),
  location: () => probeEndpoint(`${TOOLS_API_HOST}/api/geocode/London`, undefined, 2000),
  network:  () => probeEndpoint(`${TOOLS_API_HOST}/api/ip/8.8.8.8`, undefined, 2000),
  phone:    () => probeEndpoint(`${TOOLS_API_HOST}/api/phone/${encodeURIComponent('+12025551234')}`, undefined, 2000),
  compute:  () => probeEndpoint(`${TOOLS_API_HOST}/api/hash`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'probe', algorithm: 'sha256' }),
  }, 2000),
  crypto:   () => probeEndpoint(`${TOOLS_API_HOST}/api/crypto/btc`, undefined, 2000),
  security: () => probeEndpoint(`${TOOLS_API_HOST}/api/cve/CVE-2021-44228`, undefined, 2000),
};

async function probeSpecificTool(tool: ToolType): Promise<ToolEndpointStatus> {
  const fn = TOOL_PROBES[tool];
  if (!fn) return { ok: true };
  return fn();
}

async function getToolStatus(): Promise<ToolResult> {
  try {
    const status = await checkIndividualTools();
    return { success: true, data: status };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}
