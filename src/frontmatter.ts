// Writing a link into a frontmatter property. Pure, so it can be tested
// without Obsidian: the caller runs it inside processFrontMatter.

export type AddLinkResult = "added" | "present" | "full";

/**
 * Add `link` to the property `key` of `frontmatter`, matching an existing key
 * case-insensitively. A list property gains an entry; a text property holds
 * one value, so it only takes the link while empty.
 */
export function addLinkToProperty(
  frontmatter: Record<string, unknown>,
  key: string,
  link: string,
  list: boolean
): AddLinkResult {
  const existing = Object.keys(frontmatter).find((name) => name.toLowerCase() === key.toLowerCase()) ?? key;
  const current = frontmatter[existing];
  const empty = current === undefined || current === null || current === "";

  if (list) {
    const values: unknown[] = Array.isArray(current) ? current : empty ? [] : [current];
    if (values.includes(link)) return "present";
    frontmatter[existing] = [...values, link];
    return "added";
  }

  if (current === link) return "present";
  if (!empty) return "full";
  frontmatter[existing] = link;
  return "added";
}
