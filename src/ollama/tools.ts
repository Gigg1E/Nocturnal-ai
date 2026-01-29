import { getConfig } from '../config';
import { logger, logToolCall } from '../utils/logger';

const TOOLS_API_HOST = process.env.TOOLS_API_HOST || 'http://localhost:3100';

// ==================== TOOL DEFINITIONS ====================

export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

export type ToolType = 'search' | 'weather' | 'time' | 'location' | 'network';

// ==================== WEIGHT CALCULATION ====================

export interface ToolWeights {
  search: number;
  weather: number;
  time: number;
  location: number;
  network: number;
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

// ==================== TOOL EXECUTION ====================

export interface ToolContext {
  message: string;
  toolsToCall: ToolType[];
}

export async function executeTools(context: ToolContext): Promise<Map<string, ToolResult>> {
  const results = new Map<string, ToolResult>();
  const message = context.message.toLowerCase();

  for (const tool of context.toolsToCall) {
    switch (tool) {
      case 'search': {
        // Extract search query from message
        const searchQuery = extractSearchQuery(context.message);
        if (searchQuery) {
          results.set('search', await searchWeb(searchQuery));
        }
        break;
      }

      case 'weather': {
        const location = extractLocation(context.message);
        if (location) {
          results.set('weather', await getWeather(location));
        }
        break;
      }

      case 'time': {
        // Check if asking for specific timezone
        const timezone = extractTimezone(context.message);
        if (timezone) {
          results.set('timezone', await getTimezone(timezone));
        } else {
          results.set('time', await getCurrentTime());
        }
        break;
      }

      case 'location': {
        const coords = extractCoordinates(context.message);
        if (coords) {
          results.set('reverse-geocode', await reverseGeocode(coords.lat, coords.lon));
        } else {
          const locationName = extractLocation(context.message);
          if (locationName) {
            results.set('geocode', await geocode(locationName));
          }
        }
        break;
      }

      case 'network': {
        if (message.includes('ping')) {
          const host = extractHostname(context.message);
          if (host) {
            results.set('ping', await pingHost(host));
          }
        } else if (message.includes('dns') || message.includes('resolve')) {
          const hostname = extractHostname(context.message);
          if (hostname) {
            results.set('dns', await dnsLookup(hostname));
          }
        } else if (message.includes('ip')) {
          const ip = extractIpAddress(context.message);
          results.set('ip', await getIpInfo(ip || undefined));
        }
        break;
      }
    }
  }

  return results;
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

// ==================== FORMAT TOOL RESULTS FOR AI ====================

export function formatToolResultsForAI(results: Map<string, ToolResult>): string {
  if (results.size === 0) return '';

  const parts: string[] = ['[Tool Results]'];

  for (const [tool, result] of results) {
    if (result.success) {
      parts.push(`\n${tool.toUpperCase()}:\n${JSON.stringify(result.data, null, 2)}`);
    } else {
      parts.push(`\n${tool.toUpperCase()}: Error - ${result.error}`);
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
