const KEY = "qc.weavers";
const SEED = ["Supodo", "Minnal", "Bitu", "Ganesh", "Sanjith"];

export function getWeavers(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) {
      localStorage.setItem(KEY, JSON.stringify(SEED));
      return [...SEED];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return [...SEED];
    return parsed.filter((x) => typeof x === "string");
  } catch {
    return [...SEED];
  }
}

export function addWeaver(name: string): string[] {
  const trimmed = name.trim();
  if (!trimmed) return getWeavers();
  const list = getWeavers();
  if (list.some((w) => w.toLowerCase() === trimmed.toLowerCase())) return list;
  const next = [...list, trimmed];
  localStorage.setItem(KEY, JSON.stringify(next));
  return next;
}
