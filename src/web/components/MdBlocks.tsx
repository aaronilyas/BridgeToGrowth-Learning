import { type ComponentType, type JSX } from "react";
import { splitMarkdownBlocks } from "../../shared/markdown.ts";

// O(n) in text length
// INV: completed prefix blocks keep the same string and the same index key when the tail grows, so a memoised Body skips them
export function MdBlocks({ text, visuals = false, Body }: { text: string; visuals?: boolean; Body: ComponentType<{ text: string; visuals?: boolean }> }): JSX.Element {
  return (
    <>
      {splitMarkdownBlocks(text).map((block, i) => (
        <Body key={i} text={block} visuals={visuals} />
      ))}
    </>
  );
}
