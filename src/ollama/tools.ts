import { boundedFetch as timedFetch } from '../utils/http';
import { logger, logToolCall } from '../utils/logger';
import { ToolDefinition } from './client';

const boundedFetch = (url: string, init?: RequestInit) => timedFetch(url, init, 15_000);

const TOOLS_API_HOST = process.env.TOOLS_API_HOST || 'http://localhost:3100';

// ==================== TYPES ====================

export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
  endpointUp?: boolean;
  endpointError?: string;
}

export interface ToolEndpointStatus {
  ok: boolean;
  error?: string;
}

// ==================== TOOL GUIDANCE ====================
// Appended to the system prompt (chat-bot and Answer Machine) whenever
// tools are on. No date is injected into the prompt on purpose: the model
// decides per message whether "now" matters and checks the time itself --
// the goal is relevant data when it helps, not a lookup on every message.

export const TOOL_GUIDANCE = `You have live tools: search_web, get_weather, get_current_time / get_timezone, geocode_location / reverse_geocode, and crypto_price. You don't automatically know today's date or what's going on right now -- what you know on your own is from the past. For each message, decide for yourself whether fresh data would make your reply right or more relevant:
- If the answer depends on right now (today's weather, a current price, news, scores, releases, "today", "tonight", "this week"), look it up. When timing matters, check the current time too, so you know what "today" or "last night" means and whether search results are actually recent.
- If it's about a time relative to now ("a week ago", "last month", "how long until..."), get the current time and work from it.
- If it's just conversation ("I like the weather", an opinion, a joke), use judgment: sometimes a quick lookup makes your reply more relevant, and sometimes just responding or asking them about it is the more natural move. Don't look things up for the sake of it.
- If someone says not to look anything up, or just wants your take, don't.
Never mention the tools themselves -- just use what they return.`;

// ==================== TOOL SCHEMAS ====================
// Passed to Ollama so the model can decide which tools to call and with what arguments.
// Chat/informational tools only.

export const TOOL_SCHEMAS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'search_web',
      description: 'Search the web for current information, recent news, or facts you are unsure about.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'The search query' },
          num_results: { type: 'number', description: 'Number of results to return (default 5)' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_weather',
      description: 'Get current weather conditions for a city or location.',
      parameters: {
        type: 'object',
        properties: {
          location: { type: 'string', description: 'City or location name (e.g. "London", "New York")' },
        },
        required: ['location'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_current_time',
      description: 'Get the current date and time in UTC.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_timezone',
      description: 'Get the current time in a specific timezone.',
      parameters: {
        type: 'object',
        properties: {
          timezone: { type: 'string', description: 'Timezone identifier (e.g. "America/New_York", "Europe/London")' },
        },
        required: ['timezone'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'geocode_location',
      description: 'Look up coordinates (latitude/longitude) for a place name or address.',
      parameters: {
        type: 'object',
        properties: {
          location: { type: 'string', description: 'Place name or address to geocode' },
        },
        required: ['location'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'reverse_geocode',
      description: 'Look up the place name for a set of coordinates.',
      parameters: {
        type: 'object',
        properties: {
          lat: { type: 'number', description: 'Latitude' },
          lon: { type: 'number', description: 'Longitude' },
        },
        required: ['lat', 'lon'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'crypto_price',
      description: 'Get the current price of a cryptocurrency.',
      parameters: {
        type: 'object',
        properties: {
          symbol: { type: 'string', description: 'Ticker symbol (e.g. "btc", "eth", "sol")' },
        },
        required: ['symbol'],
      },
    },
  },
];

// ==================== TOOL LABELS ====================

const TOOL_LABELS: Record<string, string> = {
  search_web:       '🔍 web search',
  get_weather:      '🌤️ weather',
  get_current_time: '🕐 time',
  get_timezone:     '🕐 timezone',
  geocode_location: '📍 location',
  reverse_geocode:  '📍 location',
  crypto_price:     '💰 crypto',
};

export function getToolLabel(name: string): string {
  return TOOL_LABELS[name] ?? `🔧 ${name}`;
}

// ==================== ARG FORMATTING ====================
// Returns a short human-readable string describing what the tool is acting on.

export function formatToolArgs(name: string, args: Record<string, unknown>): string {
  const str = (key: string) => String(args[key] ?? '').trim();
  const truncate = (s: string, max = 48) => s.length > max ? s.slice(0, max - 1) + '…' : s;

  switch (name) {
    case 'search_web':       return truncate(`"${str('query')}"`);
    case 'get_weather':      return truncate(str('location'));
    case 'get_current_time': return '';
    case 'get_timezone':     return truncate(str('timezone'));
    case 'geocode_location': return truncate(str('location'));
    case 'reverse_geocode':  return `${str('lat')}, ${str('lon')}`;
    case 'crypto_price':     return str('symbol').toUpperCase();
    default:                 return '';
  }
}

// ==================== TOOL DISPATCH ====================

export async function dispatchTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
  switch (name) {
    case 'search_web':
      return searchWeb(String(args.query ?? ''), Number(args.num_results ?? 5));
    case 'get_weather':
      return getWeather(String(args.location ?? ''));
    case 'get_current_time':
      return getCurrentTime();
    case 'get_timezone':
      return getTimezone(String(args.timezone ?? ''));
    case 'geocode_location':
      return geocode(String(args.location ?? ''));
    case 'reverse_geocode':
      return reverseGeocode(Number(args.lat), Number(args.lon));
    case 'crypto_price':
      return getCryptoPrice(String(args.symbol ?? ''));
    default:
      return { success: false, error: `Unknown tool: ${name}` };
  }
}

// ==================== TOOL IMPLEMENTATIONS ====================

export async function searchWeb(query: string, numResults: number = 5): Promise<ToolResult> {
  const startTime = Date.now();
  try {
    const response = await boundedFetch(`${TOOLS_API_HOST}/api/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, num_results: numResults }),
    });
    if (!response.ok) throw new Error(`Search API error: ${response.status}`);
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
    const response = await boundedFetch(`${TOOLS_API_HOST}/api/weather/${encodeURIComponent(location)}`);
    if (!response.ok) throw new Error(`Weather API error: ${response.status}`);
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
    const response = await boundedFetch(`${TOOLS_API_HOST}/api/timezone/${encodeURIComponent(timezone)}`);
    if (!response.ok) throw new Error(`Timezone API error: ${response.status}`);
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
    const response = await boundedFetch(`${TOOLS_API_HOST}/api/time`);
    if (!response.ok) throw new Error(`Time API error: ${response.status}`);
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
    const response = await boundedFetch(`${TOOLS_API_HOST}/api/geocode/${encodeURIComponent(location)}`);
    if (!response.ok) throw new Error(`Geocode API error: ${response.status}`);
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
    const response = await boundedFetch(`${TOOLS_API_HOST}/api/reverse-geocode/${lat}/${lon}`);
    if (!response.ok) throw new Error(`Reverse geocode API error: ${response.status}`);
    const data = await response.json();
    logToolCall('reverse-geocode', { lat, lon }, true, Date.now() - startTime);
    return { success: true, data };
  } catch (error) {
    logToolCall('reverse-geocode', { lat, lon }, false, Date.now() - startTime);
    logger.error('Reverse geocode tool error:', error);
    return { success: false, error: (error as Error).message };
  }
}

export async function getCryptoPrice(symbol: string): Promise<ToolResult> {
  const startTime = Date.now();
  try {
    const response = await boundedFetch(`${TOOLS_API_HOST}/api/crypto/${encodeURIComponent(symbol)}`);
    if (!response.ok) throw new Error(`Crypto API error: ${response.status}`);
    const data = await response.json();
    logToolCall('crypto', { symbol }, true, Date.now() - startTime);
    return { success: true, data };
  } catch (error) {
    logToolCall('crypto', { symbol }, false, Date.now() - startTime);
    return { success: false, error: (error as Error).message };
  }
}

// ==================== API HEALTH CHECKS ====================

export async function checkToolsApiConnection(): Promise<boolean> {
  try {
    const response = await boundedFetch(`${TOOLS_API_HOST}/health`);
    return response.ok;
  } catch {
    return false;
  }
}

async function probeEndpoint(
  url: string,
  options?: RequestInit,
  timeoutMs = 5000
): Promise<ToolEndpointStatus> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await boundedFetch(url, { ...options, signal: ctrl.signal as RequestInit['signal'] });
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
    }).then((s) => ['search', s] as const),
    probeEndpoint(`${TOOLS_API_HOST}/api/weather/London`).then((s) => ['weather', s] as const),
    probeEndpoint(`${TOOLS_API_HOST}/api/time`).then((s) => ['time', s] as const),
    probeEndpoint(`${TOOLS_API_HOST}/api/geocode/London`).then((s) => ['location', s] as const),
    probeEndpoint(`${TOOLS_API_HOST}/api/crypto/btc`).then((s) => ['crypto', s] as const),
  ]);
  return Object.fromEntries(entries);
}
