"use client"

import { useState } from "react"
import { Document, Page, pdfjs } from "react-pdf"
import { Loader2, AlertCircle } from "lucide-react"

// Configure PDF.js worker from CDN
pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`

export default function PdfViewer({ url }) {
  // Resolve relative URLs (e.g. /v1/chat/reports/...) against the API origin
  // so react-pdf fetches from the correct backend, not the Next.js origin.
  const resolvedUrl = url?.startsWith("/")
    ? `${typeof window !== "undefined" ? window.location.origin : ""}${url}`
    : url || ""

  const [numPages, setNumPages] = useState(null)
  const [pageNumber, setPageNumber] = useState(1)

  function onDocumentLoadSuccess({ numPages }) {
    setNumPages(numPages)
  }

  return (
    <div className="flex flex-col items-center">
      <Document
        file={resolvedUrl}
        onLoadSuccess={onDocumentLoadSuccess}
        loading={
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-zinc-400" />
          </div>
        }
        error={
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <AlertCircle className="mb-2 h-8 w-8 text-red-400" />
            <p className="text-sm text-zinc-500">No se pudo cargar la previsualización del PDF.</p>
          </div>
        }
      >
        {Array.from(new Array(numPages), (el, index) => (
          <Page
            key={`page_${index + 1}`}
            pageNumber={index + 1}
            className="mb-4"
            renderTextLayer={false}
            renderAnnotationLayer={false}
            width={340}
          />
        ))}
      </Document>
      {numPages > 1 && (
        <p className="text-xs text-zinc-400 mt-2">{numPages} páginas</p>
      )}
    </div>
  )
}
