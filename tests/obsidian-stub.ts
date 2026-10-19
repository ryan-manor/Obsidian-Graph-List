// Stand-in for the "obsidian" package, which ships types but no runtime code.
// The test bundle aliases "obsidian" here so modules that touch it at runtime
// (instanceof TFile, getAllTags, classes extended at load) can still be loaded.
// Only what the tested modules reach for is implemented.

export class TFile {
  path = "";
  basename = "";
  extension = "md";
  parent: { path: string } | null = null;
  stat = { ctime: 0, mtime: 0, size: 0 };
}

export class App {}
export class AbstractInputSuggest<T> {
  declare _value?: T;
}
export class PluginSettingTab {}
export class Setting {}

export function getAllTags(cache: {
  frontmatter?: { tags?: string[] };
}): string[] | null {
  return cache.frontmatter?.tags?.map((tag) => `#${tag}`) ?? null;
}
