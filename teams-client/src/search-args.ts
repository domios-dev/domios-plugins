import { MAX_COUNT, SEARCH_DEFAULT_LIMIT } from "./constants";

const SEARCH_USAGE = "Usage: search-messages <query> [--chat <chat-id | name>] [--limit <1-50>]. Quote a multi-word chat name.";

export function parseSearchArgs(args: string[]): { query: string; chat?: string; limit: number } | { error: string } {
  const words: string[] = [];
  let chat: string | undefined;
  let limit = SEARCH_DEFAULT_LIMIT;
  for (let i = 0; i < args.length; i++) {
    const arg = String(args[i]);
    if (arg === "--chat") {
      const value = String(args[i + 1] ?? "").trim();
      if (chat !== undefined || !value || value.length > 512) return { error: `invalid-request: ${SEARCH_USAGE}` };
      chat = value;
      i++;
    } else if (arg === "--limit") {
      const value = String(args[i + 1] ?? "");
      if (!/^[0-9]{1,2}$/.test(value) || Number(value) < 1 || Number(value) > MAX_COUNT) return { error: `invalid-request: --limit must be an integer from 1 to ${MAX_COUNT}.` };
      limit = Number(value);
      i++;
    } else words.push(arg);
  }
  const query = words.join(" ").trim();
  if (query.length < 2 || query.length > 200) return { error: `invalid-request: ${SEARCH_USAGE} The query needs 2 to 200 characters.` };
  return { query, chat, limit };
}

