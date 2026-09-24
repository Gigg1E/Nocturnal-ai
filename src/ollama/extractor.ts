import { logger } from '../utils/logger';

const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://localhost:11434';
const EXTRACTOR_MODEL = 'qwen2.5:1.5b';

export interface ExtractedEntities {
  location?: string;
  searchQuery?: string;
  timezone?: string;
  hostname?: string;
  ipAddress?: string;
  coordinates?: { lat: number; lon: number };
  phoneNumber?: string;
}

const EXTRACTION_PROMPT = `You are an entity extractor. Extract structured data from the user message.

Rules:
- Extract ONLY the specific entity, not the full phrase
- For locations: extract just the city/place name (e.g., "Washington" not "Washington where the president is")
- For search queries: extract the topic being searched
- For hostnames: extract domain names or IP addresses
- For timezones: extract timezone identifiers (e.g., "America/New_York")
- For phone numbers: extract the raw number as-is, including country prefix if present (e.g., "+14155552671" or "415-555-2671")
- If an entity is not present, omit it from the response

Respond with ONLY valid JSON, no explanation:
{"location": "city name", "searchQuery": "topic", "timezone": "Zone/City", "hostname": "domain.com", "ipAddress": "1.2.3.4", "phoneNumber": "+14155552671"}`;

export async function extractEntities(message: string): Promise<ExtractedEntities> {
  const startTime = Date.now();

  try {
    const response = await fetch(`${OLLAMA_HOST}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: EXTRACTOR_MODEL,
        prompt: `${EXTRACTION_PROMPT}\n\nUser message: "${message}"\n\nJSON:`,
        stream: false,
        options: {
          temperature: 0.1,
          num_predict: 150,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Extractor API error: ${response.status}`);
    }

    const data = await response.json() as { response?: string };
    const responseText = data.response?.trim() || '{}';

    // Parse JSON from response, handling potential markdown code blocks
    let jsonStr = responseText;
    if (jsonStr.includes('```')) {
      const match = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
      jsonStr = match ? match[1].trim() : jsonStr;
    }

    // Find JSON object in response
    const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      logger.warn('Extractor returned no valid JSON:', responseText);
      return {};
    }

    const entities = JSON.parse(jsonMatch[0]) as ExtractedEntities;

    // Validate and clean extracted entities
    const cleaned: ExtractedEntities = {};

    if (entities.location && typeof entities.location === 'string' && entities.location.length > 0) {
      // Clean location: remove trailing punctuation and limit length
      cleaned.location = entities.location.replace(/[.,!?;:]+$/, '').trim().substring(0, 100);
    }

    if (entities.searchQuery && typeof entities.searchQuery === 'string' && entities.searchQuery.length > 0) {
      cleaned.searchQuery = entities.searchQuery.trim().substring(0, 200);
    }

    if (entities.timezone && typeof entities.timezone === 'string' && entities.timezone.includes('/')) {
      cleaned.timezone = entities.timezone.trim();
    }

    if (entities.hostname && typeof entities.hostname === 'string') {
      // Validate hostname format
      const hostnameMatch = entities.hostname.match(/^[a-zA-Z0-9][a-zA-Z0-9.-]*\.[a-zA-Z]{2,}$/);
      if (hostnameMatch) {
        cleaned.hostname = entities.hostname.trim();
      }
    }

    if (entities.ipAddress && typeof entities.ipAddress === 'string') {
      // Validate IP format
      const ipMatch = entities.ipAddress.match(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/);
      if (ipMatch) {
        cleaned.ipAddress = entities.ipAddress.trim();
      }
    }

    if (entities.phoneNumber && typeof entities.phoneNumber === 'string') {
      // Allow digits, spaces, dashes, parens, dots, and leading +
      const phoneMatch = entities.phoneNumber.match(/^\+?[\d\s\-().]{7,}$/);
      if (phoneMatch) {
        cleaned.phoneNumber = entities.phoneNumber.trim();
      }
    }

    const duration = Date.now() - startTime;
    logger.debug(`Entity extraction completed in ${duration}ms:`, cleaned);

    return cleaned;
  } catch (error) {
    logger.error('Entity extraction error:', error);
    return {};
  }
}

// Check if the extractor model is available
export async function checkExtractorModel(): Promise<boolean> {
  try {
    const response = await fetch(`${OLLAMA_HOST}/api/tags`);
    if (!response.ok) return false;

    const data = await response.json() as { models?: Array<{ name: string }> };
    const models = data.models || [];
    return models.some((m: { name: string }) => m.name.startsWith('qwen2.5:1.5b'));
  } catch {
    return false;
  }
}
