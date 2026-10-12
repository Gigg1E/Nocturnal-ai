const NUMBER_RULES: Record<string, [number, number, boolean]> = {
  'casualChat.turnSpacingMs': [0, 120000, true],
  'casualChat.groupPauseMs': [0, 60000, true],
  'casualChat.typingGraceMs': [0, 60000, true],
  'casualChat.maxTurnWaitMs': [1000, 120000, true],
  'ollama.maxTokens': [1, 32768, true],
  'ollama.temperature': [0, 1, false],
  'ollama.topP': [0, 1, false],
  'bot.maxResponseLength': [100, 1999, true],
  'bot.maxChatsPerUser': [1, 10, true],
  'rateLimit.cooldownMs': [0, 3600000, true],
  'rateLimit.maxRequestsPerMinute': [1, 1000, true],
  'rateLimit.maxRequestsPerHour': [1, 10000, true],
};

export function parseSetting(key: string, input: string): string | number | boolean {
  const rule = NUMBER_RULES[key];
  if (rule) {
    const value = input.trim() ? Number(input) : NaN;
    const [min, max, integer] = rule;
    if (!Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
      throw new Error(`Expected ${integer ? 'an integer' : 'a number'} between ${min} and ${max}.`);
    }
    return value;
  }
  if ((key === 'tools.enabled' || key === 'casualChat.typingProtection')) {
    if (!/^(true|false)$/i.test(input.trim())) throw new Error('Expected true or false.');
    return input.trim().toLowerCase() === 'true';
  }
  if (key === 'logging.level' && ['error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly'].includes(input)) return input;
  throw new Error('Unsupported setting or value.');
}
