function isNonFactualHeading(heading) {
  return /limitations?|known limits?|uncovered|uncertaint|sources?|references?|contents?|navigation|how to read|源码引用|限制|未覆盖|不确定|目录|导航|阅读指南/i.test(heading);
}

export function missingFactualSectionCitations(markdown) {
  const headings = [...markdown.matchAll(/^##\s+(.+)$/gm)];
  const missing = [];
  for (const [index, heading] of headings.entries()) {
    const title = heading[1].trim();
    const body = markdown.slice((heading.index ?? 0) + heading[0].length, headings[index + 1]?.index ?? markdown.length);
    if (!isNonFactualHeading(title) && !/\[S[1-9][0-9]{0,3}\]/.test(body)) missing.push(title);
  }
  return missing;
}
