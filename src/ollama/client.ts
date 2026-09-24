import { getConfig } from '../config';
import { logger } from '../utils/logger';

function buildOllamaHost(): string {
  const raw = process.env.OLLAMA_HOST || 'http://localhost:11434';
  if (!raw.startsWith('http://') && !raw.startsWith('https://')) {
    return `http://${raw}`;
  }
  return raw;
}
const OLLAMA_HOST = buildOllamaHost();

export interface ToolCall {
  function: {
    name: string;
    arguments: Record<string, unknown> | string;
  };
}

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface OllamaMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  images?: string[];
  tool_calls?: ToolCall[];
}

export interface OllamaGenerateOptions {
  model?: string;
  messages: OllamaMessage[];
  stream?: boolean;
  tools?: ToolDefinition[];
  options?: {
    num_predict?: number;
    temperature?: number;
    top_p?: number;
  };
}

export interface OllamaResponse {
  model: string;
  created_at: string;
  message: {
    role: string;
    content: string;
    tool_calls?: ToolCall[];
  };
  done: boolean;
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
}

export async function generateChat(options: OllamaGenerateOptions): Promise<OllamaResponse> {
  const config = getConfig();
  const model = options.model || config.ollama.chatModel;

  const body: Record<string, unknown> = {
    model,
    messages: options.messages,
    stream: false,
    options: {
      num_predict: options.options?.num_predict ?? config.ollama.maxTokens,
      temperature: options.options?.temperature ?? config.ollama.temperature,
      top_p: options.options?.top_p ?? config.ollama.topP,
    },
  };

  if (options.tools && options.tools.length > 0) {
    body.tools = options.tools;
  }

  try {
    const response = await fetch(`${OLLAMA_HOST}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
    }

    return await response.json() as OllamaResponse;
  } catch (error) {
    logger.error('Ollama generate error:', error);
    throw error;
  }
}

export async function generateVision(
  prompt: string,
  imageBase64: string,
  context?: OllamaMessage[]
): Promise<OllamaResponse> {
  const config = getConfig();

  const messages: OllamaMessage[] = context || [];
  messages.push({
    role: 'user',
    content: prompt,
    images: [imageBase64],
  });

  try {
    const response = await fetch(`${OLLAMA_HOST}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.ollama.visionModel,
        messages,
        stream: false,
        options: {
          num_predict: config.ollama.maxTokens,
          temperature: config.ollama.temperature,
          top_p: config.ollama.topP,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama Vision API error: ${response.status} ${response.statusText}`);
    }

    return await response.json() as OllamaResponse;
  } catch (error) {
    logger.error('Ollama vision error:', error);
    throw error;
  }
}

export async function listModels(): Promise<string[]> {
  try {
    const response = await fetch(`${OLLAMA_HOST}/api/tags`);
    if (!response.ok) throw new Error(`Failed to list models: ${response.status}`);
    const data = await response.json() as { models: Array<{ name: string }> };
    return data.models.map((m) => m.name);
  } catch (error) {
    logger.error('Failed to list Ollama models:', error);
    return [];
  }
}

export async function checkOllamaConnection(): Promise<boolean> {
  try {
    const response = await fetch(`${OLLAMA_HOST}/api/tags`);
    return response.ok;
  } catch {
    return false;
  }
}

export async function imageUrlToBase64(url: string): Promise<string> {
  try {
    const response = await fetch(url);
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer).toString('base64');
  } catch (error) {
    logger.error('Failed to convert image to base64:', error);
    throw error;
  }
}

export function shouldUseVisionModel(hasImage: boolean, messageContent: string): boolean {
  if (!hasImage) return false;
  const visionKeywords = [
    'what', 'describe', 'explain', 'analyze', 'look', 'see', 'show',
    'image', 'picture', 'photo', 'screenshot', 'this', 'that',
    'read', 'text', 'ocr', 'identify', 'recognize',
  ];
  const lower = messageContent.toLowerCase();
  return visionKeywords.some((kw) => lower.includes(kw));
}
