import mammoth from "mammoth";
import * as XLSX from "xlsx";
import type { ContentBlock } from "@/lib/ai/client";

/**
 * Turn an uploaded file into content blocks Claude can read.
 * PDFs and images go in natively; Word and Excel are converted to text here.
 * Legacy .doc files are not supported — ask for a PDF or .docx.
 */
export async function fileToBlocks(buf: Buffer, mimeType: string, filename: string): Promise<{ blocks: ContentBlock[]; textPreview: string | null }> {
  const lower = filename.toLowerCase();
  if (mimeType === "application/pdf" || lower.endsWith(".pdf")) {
    return { blocks: [{ type: "document", source: { type: "base64", media_type: "application/pdf", data: buf.toString("base64") }, title: filename }], textPreview: null };
  }
  if (lower.endsWith(".docx") || mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    const { value } = await mammoth.extractRawText({ buffer: buf });
    return { blocks: [{ type: "text", text: `Document "${filename}" (Word, converted to text):\n\n${value}` }], textPreview: value };
  }
  if (lower.endsWith(".xlsx") || lower.endsWith(".xls") || lower.endsWith(".csv") || mimeType.includes("spreadsheet") || mimeType === "text/csv") {
    const wb = XLSX.read(buf, { type: "buffer" });
    const parts: string[] = [];
    for (const name of wb.SheetNames) {
      const csv = XLSX.utils.sheet_to_csv(wb.Sheets[name], { blankrows: false });
      parts.push(`--- Sheet: ${name} ---\n${csv}`);
    }
    const txt = parts.join("\n\n");
    return { blocks: [{ type: "text", text: `Workbook "${filename}" (converted to CSV per sheet):\n\n${txt}` }], textPreview: txt };
  }
  if (/^image\/(png|jpeg|webp|gif)$/.test(mimeType)) {
    return { blocks: [{ type: "image", source: { type: "base64", media_type: mimeType as "image/png", data: buf.toString("base64") } }], textPreview: null };
  }
  if (mimeType.startsWith("text/") || lower.endsWith(".txt") || lower.endsWith(".md")) {
    const txt = buf.toString("utf8");
    return { blocks: [{ type: "text", text: `Document "${filename}":\n\n${txt}` }], textPreview: txt };
  }
  throw new Error(`Unsupported file type for extraction: ${filename}. Upload a PDF, .docx, .xlsx or image.`);
}
