export function getValueByPath<T = unknown>(data: unknown, path: string | undefined): T | undefined {
  if (!path) {
    return data as T;
  }

  const segments = path
    .split('.')
    .map((segment) => segment.trim())
    .filter(Boolean);

  let current: any = data;
  for (const segment of segments) {
    if (current == null) {
      return undefined;
    }
    if (Array.isArray(current)) {
      const index = Number(segment);
      if (Number.isNaN(index) || index < 0 || index >= current.length) {
        return undefined;
      }
      current = current[index];
    } else {
      current = current[segment];
    }
  }
  return current as T;
}

export function objectMatchesKeyword(
  item: Record<string, unknown>,
  keyword: string,
  candidateFields: string[]
): boolean {
  const normalizedKeyword = keyword.trim().toLowerCase();
  if (!normalizedKeyword) {
    return true;
  }

  const keywordMatcher = (value: unknown): boolean => {
    if (typeof value === 'string') {
      return value.toLowerCase().includes(normalizedKeyword);
    }
    if (Array.isArray(value)) {
      return value.some(keywordMatcher);
    }
    if (value && typeof value === 'object') {
      return keywordMatcher(Object.values(value));
    }
    return false;
  };

  for (const field of candidateFields) {
    const value = getValueByPath(item, field);
    if (keywordMatcher(value)) {
      return true;
    }
  }

  return keywordMatcher(item);
}
