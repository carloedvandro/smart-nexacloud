// Extrai texto de arquivos no navegador para alimentar a base de conhecimento.
export const KNOWLEDGE_FILE_ACCEPT =
  ".pdf,.docx,.xlsx,.xls,.csv,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv,text/plain";
export const KNOWLEDGE_FILE_MAX_BYTES = 15 * 1024 * 1024;

function ext(name: string) {
  return name.toLowerCase().split(".").pop() ?? "";
}

export async function extractFileText(file: File): Promise<string> {
  if (file.size > KNOWLEDGE_FILE_MAX_BYTES) throw new Error("Arquivo maior que 15 MB.");
  const e = ext(file.name);
  if (e === "doc") throw new Error("Arquivos .doc antigos não são suportados. Salve como .docx ou PDF.");
  if (e === "txt" || e === "csv") return (await file.text()).trim();
  const buf = await file.arrayBuffer();
  if (e === "pdf") {
    const pdfjs = await import("pdfjs-dist");
    const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
    const pages: string[] = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const tc = await page.getTextContent();
      let line = "";
      const lines: string[] = [];
      for (const it of tc.items as Array<{ str?: string; hasEOL?: boolean }>) {
        line += it.str ?? "";
        if (it.hasEOL) { lines.push(line); line = ""; }
      }
      if (line) lines.push(line);
      pages.push(lines.join("\n"));
    }
    const text = pages.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
    if (!text) throw new Error("Este PDF não tem texto selecionável (parece ser imagem escaneada).");
    return text;
  }
  if (e === "docx") {
    const mammoth = await import("mammoth");
    const r = await mammoth.extractRawText({ arrayBuffer: buf });
    return r.value.replace(/\n{3,}/g, "\n\n").trim();
  }
  if (e === "xlsx" || e === "xls") {
    const XLSX = await import("xlsx");
    const wb = XLSX.read(buf, { type: "array" });
    return wb.SheetNames.map((n) => {
      const csv = XLSX.utils.sheet_to_csv(wb.Sheets[n]!, { blankrows: false });
      return `## Planilha: ${n}\n${csv}`;
    }).join("\n\n").trim();
  }
  throw new Error("Formato não suportado. Use PDF, Word (.docx), Excel (.xlsx/.xls), CSV ou TXT.");
}
