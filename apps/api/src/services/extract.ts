import { extractText as extractPdfText } from 'unpdf';

/** Plain text from an uploaded file. TXT and Markdown are already text; PDFs need parsing. */
export async function extractText(file: Buffer, mimeType: string): Promise<string> {
  if (mimeType === 'application/pdf') {
    // Copy into a fresh Uint8Array: pdf.js may take ownership of the buffer it's given.
    const { text } = await extractPdfText(new Uint8Array(file), { mergePages: true });
    return text;
  }
  return file.toString('utf8');
}
