// The signal remains active while response bodies are read, too.
export function boundedFetch(input: string | URL, init: RequestInit = {}, timeoutMs = 60_000): Promise<Response> {
  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  return fetch(input, { ...init, signal });
}
