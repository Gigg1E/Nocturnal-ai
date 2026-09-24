import { logger, logToolCall } from '../utils/logger';
import { ToolDefinition } from './client';

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

// ==================== TOOL SCHEMAS ====================
// Passed to Ollama so qwen3 can decide which tools to call and with what arguments.

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
      name: 'ip_lookup',
      description: 'Look up geolocation and network info for an IP address. Omit ip to look up the server\'s public IP.',
      parameters: {
        type: 'object',
        properties: {
          ip: { type: 'string', description: 'IPv4 address to look up (optional)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'dns_lookup',
      description: 'Resolve DNS records for a hostname.',
      parameters: {
        type: 'object',
        properties: {
          hostname: { type: 'string', description: 'Domain name to resolve (e.g. "google.com")' },
        },
        required: ['hostname'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ping_host',
      description: 'Ping a hostname or IP address to check reachability and latency.',
      parameters: {
        type: 'object',
        properties: {
          host: { type: 'string', description: 'Hostname or IP address to ping' },
        },
        required: ['host'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'whois_lookup',
      description: 'Look up WHOIS registration info for a domain.',
      parameters: {
        type: 'object',
        properties: {
          domain: { type: 'string', description: 'Domain name (e.g. "example.com")' },
        },
        required: ['domain'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'asn_lookup',
      description: 'Look up the Autonomous System Number (ASN) and network owner for an IP address.',
      parameters: {
        type: 'object',
        properties: {
          ip: { type: 'string', description: 'IP address to look up' },
        },
        required: ['ip'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ssl_check',
      description: 'Check the SSL/TLS certificate for a hostname.',
      parameters: {
        type: 'object',
        properties: {
          hostname: { type: 'string', description: 'Domain to check (e.g. "google.com")' },
        },
        required: ['hostname'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'http_status',
      description: 'Check the HTTP status code and response headers for a URL.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Full URL to check (e.g. "https://example.com")' },
        },
        required: ['url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'phone_lookup',
      description: 'Look up carrier and region info for a phone number.',
      parameters: {
        type: 'object',
        properties: {
          number: { type: 'string', description: 'Phone number including country code (e.g. "+14155552671")' },
        },
        required: ['number'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'hash_text',
      description: 'Generate a cryptographic hash of a string.',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'Text to hash' },
          algorithm: {
            type: 'string',
            description: 'Hash algorithm: sha256 (default), sha512, sha1, md5',
            enum: ['sha256', 'sha512', 'sha1', 'md5'],
          },
        },
        required: ['text'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'base64_encode',
      description: 'Encode or decode a string in Base64.',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'Text to encode or decode' },
          mode: {
            type: 'string',
            description: '"encode" (default) or "decode"',
            enum: ['encode', 'decode'],
          },
        },
        required: ['text'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'subnet_calc',
      description: 'Calculate subnet details (network address, broadcast, host range, mask) for a CIDR range.',
      parameters: {
        type: 'object',
        properties: {
          cidr: { type: 'string', description: 'CIDR notation (e.g. "192.168.1.0/24")' },
        },
        required: ['cidr'],
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
  {
    type: 'function',
    function: {
      name: 'cve_lookup',
      description: 'Look up details for a CVE vulnerability ID.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'CVE ID (e.g. "CVE-2021-44228")' },
        },
        required: ['id'],
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
  ip_lookup:        '🌐 IP lookup',
  dns_lookup:       '🌐 DNS',
  ping_host:        '🌐 ping',
  whois_lookup:     '🌐 WHOIS',
  asn_lookup:       '🌐 ASN',
  ssl_check:        '🔒 SSL',
  http_status:      '🌐 HTTP status',
  phone_lookup:     '📞 phone',
  hash_text:        '⚙️ hash',
  base64_encode:    '⚙️ base64',
  subnet_calc:      '⚙️ subnet',
  crypto_price:     '💰 crypto',
  cve_lookup:       '🛡️ CVE',
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
    case 'ip_lookup':        return args.ip ? truncate(str('ip')) : 'public IP';
    case 'dns_lookup':       return truncate(str('hostname'));
    case 'ping_host':        return truncate(str('host'));
    case 'whois_lookup':     return truncate(str('domain'));
    case 'asn_lookup':       return truncate(str('ip'));
    case 'ssl_check':        return truncate(str('hostname'));
    case 'http_status':      return truncate(str('url'));
    case 'phone_lookup':     return truncate(str('number'));
    case 'hash_text':        return truncate(`${str('algorithm') || 'sha256'}  "${str('text')}"`);
    case 'base64_encode':    return str('mode') || 'encode';
    case 'subnet_calc':      return truncate(str('cidr'));
    case 'crypto_price':     return str('symbol').toUpperCase();
    case 'cve_lookup':       return str('id').toUpperCase();
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
    case 'ip_lookup':
      return getIpInfo(args.ip ? String(args.ip) : undefined);
    case 'dns_lookup':
      return dnsLookup(String(args.hostname ?? ''));
    case 'ping_host':
      return pingHost(String(args.host ?? ''));
    case 'whois_lookup':
      return whoisLookup(String(args.domain ?? ''));
    case 'asn_lookup':
      return asnLookup(String(args.ip ?? ''));
    case 'ssl_check':
      return checkSSL(String(args.hostname ?? ''));
    case 'http_status':
      return checkHttpStatus(String(args.url ?? ''));
    case 'phone_lookup':
      return lookupPhone(String(args.number ?? ''));
    case 'hash_text':
      return hashText(String(args.text ?? ''), String(args.algorithm ?? 'sha256'));
    case 'base64_encode':
      return encodeBase64(String(args.text ?? ''), String(args.mode ?? 'encode'));
    case 'subnet_calc':
      return calcSubnet(String(args.cidr ?? ''));
    case 'crypto_price':
      return getCryptoPrice(String(args.symbol ?? ''));
    case 'cve_lookup':
      return lookupCVE(String(args.id ?? ''));
    default:
      return { success: false, error: `Unknown tool: ${name}` };
  }
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
    const response = await fetch(`${TOOLS_API_HOST}/api/weather/${encodeURIComponent(location)}`);
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
    const response = await fetch(`${TOOLS_API_HOST}/api/timezone/${encodeURIComponent(timezone)}`);
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
    const response = await fetch(`${TOOLS_API_HOST}/api/time`);
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
    const response = await fetch(`${TOOLS_API_HOST}/api/geocode/${encodeURIComponent(location)}`);
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
    const response = await fetch(`${TOOLS_API_HOST}/api/reverse-geocode/${lat}/${lon}`);
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

export async function getIpInfo(ip?: string): Promise<ToolResult> {
  const startTime = Date.now();
  try {
    const url = ip ? `${TOOLS_API_HOST}/api/ip/${ip}` : `${TOOLS_API_HOST}/api/ip`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`IP API error: ${response.status}`);
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
    if (!response.ok) throw new Error(`DNS API error: ${response.status}`);
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
    if (!response.ok) throw new Error(`Ping API error: ${response.status}`);
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
    if (!response.ok) throw new Error(`Phone API error: ${response.status}`);
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

// ==================== API HEALTH CHECKS ====================

export async function checkToolsApiConnection(): Promise<boolean> {
  try {
    const response = await fetch(`${TOOLS_API_HOST}/health`);
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
    }).then((s) => ['search', s] as const),
    probeEndpoint(`${TOOLS_API_HOST}/api/weather/London`).then((s) => ['weather', s] as const),
    probeEndpoint(`${TOOLS_API_HOST}/api/time`).then((s) => ['time', s] as const),
    probeEndpoint(`${TOOLS_API_HOST}/api/geocode/London`).then((s) => ['location', s] as const),
    probeEndpoint(`${TOOLS_API_HOST}/api/ip/8.8.8.8`).then((s) => ['network (ip)', s] as const),
    probeEndpoint(`${TOOLS_API_HOST}/api/dns/google.com`).then((s) => ['network (dns)', s] as const),
    probeEndpoint(`${TOOLS_API_HOST}/api/phone/${encodeURIComponent('+12025551234')}`).then((s) => ['phone', s] as const),
    probeEndpoint(`${TOOLS_API_HOST}/api/hash`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'probe', algorithm: 'sha256' }),
    }).then((s) => ['compute (hash)', s] as const),
    probeEndpoint(`${TOOLS_API_HOST}/api/subnet`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cidr: '192.168.1.0/24' }),
    }).then((s) => ['compute (subnet)', s] as const),
    probeEndpoint(`${TOOLS_API_HOST}/api/whois/google.com`).then((s) => ['network (whois)', s] as const),
    probeEndpoint(`${TOOLS_API_HOST}/api/asn/8.8.8.8`).then((s) => ['network (asn)', s] as const),
    probeEndpoint(`${TOOLS_API_HOST}/api/crypto/btc`).then((s) => ['crypto', s] as const),
    probeEndpoint(`${TOOLS_API_HOST}/api/cve/CVE-2021-44228`).then((s) => ['security (cve)', s] as const),
    probeEndpoint(`${TOOLS_API_HOST}/api/ssl/google.com`).then((s) => ['network (ssl)', s] as const),
    probeEndpoint(`${TOOLS_API_HOST}/api/http-status?url=${encodeURIComponent('https://google.com')}`).then((s) => ['network (http-status)', s] as const),
  ]);
  return Object.fromEntries(entries);
}
