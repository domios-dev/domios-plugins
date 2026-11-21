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

export function parseDictionary(raw: unknown): DictionaryRule[] {
  if (typeof raw !== "string" || !raw.trim()) return [];
  const entries = raw.split(/\r\n|\n|\r|;/);
  const byKey = new Map<string, { order: number; wrong: string; right: string }>();
  let order = 0;
  for (let i = 0; i < entries.length; i++) {
    const line = entries[i].trim();
    if (!line) continue;
    let sep = line.indexOf("=>");
    if (sep < 0) sep = line.indexOf("->");
    if (sep < 0) continue;
    const wrong = line.slice(0, sep).trim();
    const right = line.slice(sep + 2).trim();
    if (!wrong || !right || wrong.length > MAX_RULE_CHARS || right.length > MAX_RULE_CHARS) continue;
    const key = alignedLower(wrong);
    if (!byKey.has(key) && byKey.size >= MAX_DICTIONARY_RULES) continue;
    byKey.set(key, { order: order++, wrong: key, right });
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
