// Turn an HTML page or a PDF into { title, text, tables }.
import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";

const squeeze = (s) => s.replace(/[ \t\f\v ]+/g, " ").replace(/ ?\n ?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();

export function fromHtml(html) {
  const { document } = parseHTML(html);
  const title = (document.querySelector("title")?.textContent ?? "").trim();
  let text = "";
  try {
    // Readability rewrites the DOM it is given, so it gets its own copy.
    text = new Readability(parseHTML(html).document, { charThreshold: 100 }).parse()?.textContent ?? "";
  } catch {}
  if (!text.trim()) {
    for (const e of document.querySelectorAll("script,style,noscript,template")) e.remove();
    text = document.body?.textContent ?? "";
  }
  return { title, text: squeeze(text) };
}

export async function fromPdf(buffer, name) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer), isEvalSupported: false }).promise;
  const meta = await doc.getMetadata().catch(() => null);
  const title = meta?.info?.Title?.trim() || name.replace(/\.pdf$/i, "");
  const pages = [];
  const tables = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const { items } = await (await doc.getPage(p)).getTextContent();
    const got = layout(items);
    pages.push(got.text);
    tables.push(...got.tables);
  }
  await doc.destroy();
  return { title, text: pages.join("\n\n").trim(), tables };
}

// Rebuild lines and tables from pdf.js text items (each has str, width, transform [a,b,c,d,x,y]).
// shortcut: a table is 2+ consecutive lines whose cells (text separated by a wide gap) line up;
// wrapped cells or merged headers break it. Upgrade to a layout model when someone needs those.
export function layout(items) {
  const words = items
    .filter((it) => typeof it.str === "string" && it.str.trim())
    .map((it) => ({ str: it.str, x: it.transform[4], y: it.transform[5], w: it.width, h: it.height || 10 }))
    .sort((a, b) => b.y - a.y || a.x - b.x);

  // Group into visual lines by y, then split each line into cells on wide gaps.
  const lines = [];
  for (const w of words) {
    const line = lines.at(-1);
    if (line && Math.abs(line.y - w.y) <= Math.max(2, line.h * 0.5)) line.words.push(w);
    else lines.push({ y: w.y, h: w.h, words: [w] });
  }
  for (const line of lines) {
    line.words.sort((a, b) => a.x - b.x);
    line.cells = [];
    for (const w of line.words) {
      const cell = line.cells.at(-1);
      const charW = cell ? cell.w / Math.max(1, cell.str.length) : 0;
      const gap = cell ? w.x - (cell.x + cell.w) : 0;
      // A word space is ~0.5 char widths; table cells with any padding sit 2+ char widths apart.
      // shortcut: cells with zero padding arrive from pdf.js already fused ("Widget9.99") and cannot be split.
      if (cell && gap <= Math.max(5, 1.5 * charW)) {
        cell.str += (gap > charW * 0.3 ? " " : "") + w.str;
        cell.w = w.x + w.w - cell.x;
      } else line.cells.push({ ...w });
    }
  }

  const aligned = (a, b) =>
    a.cells.length === b.cells.length && a.cells.length >= 2 &&
    a.cells.every((c, i) => Math.abs(c.x - b.cells[i].x) <= 15 || Math.abs(c.x + c.w - b.cells[i].x - b.cells[i].w) <= 15);

  const out = [];
  const tables = [];
  let run = [];
  const flush = () => {
    if (run.length >= 2) tables.push(run.map((l) => l.cells.map((c) => c.str.trim())));
    run = [];
  };
  for (const line of lines) {
    if (run.length && aligned(run.at(-1), line)) run.push(line);
    else { flush(); if (line.cells.length >= 2) run.push(line); }
    out.push(line.cells.map((c) => c.str.trim()).join(line.cells.length >= 2 ? " | " : " "));
  }
  flush();
  return { text: out.join("\n"), tables };
}
