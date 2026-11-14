import type { ReactNode } from "react";

/** Inline `code` spans and **bold**, nothing else. */
export function inline(text: string): ReactNode[] {
  return text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).map((part, index) => {
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      return (
        <code key={index} className="rounded-[4px] bg-canvas px-1 py-px font-mono text-[0.86em] font-normal">
          {part.slice(1, -1)}
        </code>
      );
    }
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }
    return part;
  });
}

/**
 * Renders the small subset of Markdown that requirement texts use:
 * headings, paragraphs, bullet lists, fenced code and tables (shown as preformatted text).
 */
export function Prose({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let index = 0;
  let key = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (line.trim().startsWith("```")) {
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].trim().startsWith("```")) code.push(lines[index++]);
      index += 1;
      blocks.push(
        <pre key={key++} className="my-3 overflow-x-auto rounded-lg bg-canvas p-3 font-mono text-[12.5px] leading-relaxed">
          {code.join("\n")}
        </pre>,
      );
      continue;
    }

    if (line.trim().startsWith("|")) {
      const table: string[] = [];
      while (index < lines.length && lines[index].trim().startsWith("|")) table.push(lines[index++]);
      blocks.push(
        <pre key={key++} className="my-3 overflow-x-auto font-mono text-[12.5px] leading-relaxed text-soft">
          {table.join("\n")}
        </pre>,
      );
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      blocks.push(
        <h4 key={key++} className="mb-1 mt-5 text-[15px] font-semibold">
          {inline(heading[2])}
        </h4>,
      );
      index += 1;
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\s*[-*]\s+/.test(lines[index])) items.push(lines[index++].replace(/^\s*[-*]\s+/, ""));
      blocks.push(
        <ul key={key++} className="my-2 list-disc space-y-1 pl-5">
          {items.map((item, i) => (
            <li key={i}>{inline(item)}</li>
          ))}
        </ul>,
      );
      continue;
    }

    if (!line.trim()) {
      index += 1;
      continue;
    }

    const paragraph: string[] = [];
    while (
      index < lines.length &&
      lines[index].trim() &&
      !/^(#{1,6})\s/.test(lines[index]) &&
      !lines[index].trim().startsWith("```") &&
      !lines[index].trim().startsWith("|") &&
      !/^\s*[-*]\s+/.test(lines[index])
    ) {
      paragraph.push(lines[index++]);
    }
    blocks.push(
      <p key={key++} className="my-2">
        {inline(paragraph.join(" "))}
      </p>,
    );
  }

  return <div className="text-[0.95rem] leading-relaxed">{blocks}</div>;
}
