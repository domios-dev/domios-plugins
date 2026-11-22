export const MAX_DICTIONARY_RULES = 200;
export const MAX_RULE_CHARS = 128;

export type DictionaryRule = readonly [string, string];

function isWordChar(ch: string): boolean {
  if (!ch) return false;
  if ((ch >= "0" && ch <= "9") || ch === "_") return true;
  return ch.toLowerCase() !== ch.toUpperCase();
}

function alignedLower(text: string): string {
  const lower = text.toLowerCase();
  if (lower.length === text.length) return lower;
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const mapped = text[i].toLowerCase();
    out += mapped.length === 1 ? mapped : text[i];
  }
  return out;
}

interface PendingRule {
  order: number;
  wrong: string;
  right: string;
}

function addRule(
  byKey: Map<string, PendingRule>,
  wrongRaw: string,
  rightRaw: string,
  order: number,
): number {
  const wrong = wrongRaw.trim();
  const right = rightRaw.trim();
  if (!wrong || !right || wrong.length > MAX_RULE_CHARS || right.length > MAX_RULE_CHARS) {
    return order;
  }
  const key = alignedLower(wrong);
  if (!byKey.has(key) && byKey.size >= MAX_DICTIONARY_RULES) {
    return order;
  }
  byKey.set(key, { order, wrong: key, right });
  return order + 1;
}

export function parseDictionary(raw: unknown): DictionaryRule[] {
  const byKey = new Map<string, PendingRule>();
  let order = 0;

  if (Array.isArray(raw)) {
    for (let i = 0; i < raw.length; i++) {
      const item = raw[i];
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const entry = item as { from?: unknown; to?: unknown };
      if (typeof entry.from !== "string" || typeof entry.to !== "string") continue;
      order = addRule(byKey, entry.from, entry.to, order);
    }
  } else if (typeof raw === "string" && raw.trim()) {
    const entries = raw.split(/\r\n|\n|\r|;/);
    for (let i = 0; i < entries.length; i++) {
      const line = entries[i].trim();
      if (!line) continue;
      let sep = line.indexOf("=>");
      if (sep < 0) sep = line.indexOf("->");
      if (sep < 0) continue;
      order = addRule(byKey, line.slice(0, sep), line.slice(sep + 2), order);
    }
  } else {
    return [];
  }

  const rules = Array.from(byKey.values());
  rules.sort((a, b) => b.wrong.length - a.wrong.length || a.order - b.order);
  return rules.map((r) => [r.wrong, r.right] as const);
}

export function applyDictionary(text: string, rules: readonly DictionaryRule[]): string {
  if (!text || !rules.length) return text;
  const lower = alignedLower(text);
  let out = "";
  let i = 0;
  while (i < text.length) {
    let matched: DictionaryRule | null = null;
    for (let r = 0; r < rules.length; r++) {
      const rule = rules[r];
      const wrong = rule[0];
      if (!wrong || !lower.startsWith(wrong, i)) continue;
      const end = i + wrong.length;
      if (isWordChar(wrong[0]) && i > 0 && isWordChar(text[i - 1])) continue;
      if (isWordChar(wrong[wrong.length - 1]) && end < text.length && isWordChar(text[end])) continue;
      matched = rule;
      break;
    }
    if (matched) {
      out += matched[1];
      i += matched[0].length;
    } else {
      out += text[i];
      i += 1;
    }
  }
  return out;
}

export function configuredDictionaryRules(): DictionaryRule[] {
  try {
    const parsed = JSON.parse(host.settingsJson()) as { dictionary?: unknown } | null;
    return parseDictionary(parsed?.dictionary);
  } catch {
    return [];
  }
}
