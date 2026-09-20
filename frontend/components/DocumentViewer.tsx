"use client";

import { useState, useRef, useEffect } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

// Point pdfjs at the bundled worker that ships with pdfjs-dist.
// Using the legacy build avoids the need for a separate worker file.
pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

/**
 * High-quality PDF viewer using react-pdf + PDF.js canvas rendering.
 *
 * Each page is rasterized at devicePixelRatio × scale so text stays
 * crisp on retina / high-DPI screens. Falls back to an <object> embed
 * for non-PDF documents.
 */
export function DocumentViewer({
  url,
  contentType,
}: {
  url?: string;
  contentType?: string;
}) {
  const [numPages, setNumPages] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);
  const [containerWidth, setContainerWidth] = useState<number>(780);
  const containerRef = useRef<HTMLDivElement>(null);

  // Measure the container so we can scale each PDF page to fill it.
  useEffect(() => {
    if (!containerRef.current) return;
    const obs = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) setContainerWidth(Math.floor(w));
    });
    obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  if (!url) return <div className="text-brand-400">No document available.</div>;

  const isPdf =
    contentType === "application/pdf" || /\.pdf(\?|$)/i.test(url);

  if (!isPdf) {
    return (
      <img
        src={url}
        alt="Uploaded document"
        className="w-full rounded border border-brand-100 object-contain max-h-[780px]"
        onError={() => setError("Failed to load image.")}
      />
    );
  }

  return (
    <div ref={containerRef} className="flex flex-col gap-2">
      {error ? (
        <div className="text-risk-high text-sm p-4">{error}</div>
      ) : (
        <div
          className="overflow-y-auto rounded border border-brand-100 bg-white"
          style={{ maxHeight: "800px" }}
        >
          <Document
            file={url}
            onLoadSuccess={({ numPages }) => setNumPages(numPages)}
            onLoadError={(e) => setError(`Failed to load PDF: ${e.message}`)}
            loading={
              <div className="flex items-center justify-center h-48 text-brand-400 text-sm">
                Loading document…
              </div>
            }
          >
            {Array.from({ length: numPages }, (_, i) => (
              <Page
                key={`page_${i + 1}`}
                pageNumber={i + 1}
                width={containerWidth}
                devicePixelRatio={typeof window !== 'undefined' ? Math.max(window.devicePixelRatio * 2, 3) : 3}
                renderTextLayer={true}
                renderAnnotationLayer={false}
                className="mb-1 last:mb-0"
              />
            ))}
          </Document>
        </div>
      )}

      {/* Always provide a link to the original for maximum quality */}
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-xs text-brand-500 underline self-end"
      >
        View full size ↗
      </a>
    </div>
  );
}
