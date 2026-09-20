"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";

const ACCEPT = ".pdf,.jpg,.jpeg,.png";

export default function UploadPage() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleUpload() {
    if (!file) return;
    setBusy(true);
    setStatus("Requesting upload URL …");
    try {
      const meta = await api.requestUpload({
        filename: file.name,
        content_type: file.type || "application/octet-stream",
        size_bytes: file.size,
      });
      setStatus("Uploading to S3 …");
      const putRes = await fetch(meta.upload_url, {
        method: "PUT",
        headers: {
          "Content-Type": file.type || "application/octet-stream",
          "x-amz-meta-original-filename": file.name,
        },
        body: file,
      });
      if (!putRes.ok) throw new Error(`S3 PUT failed: ${putRes.status}`);
      setStatus(`Uploaded. Pipeline started. record_id: ${meta.record_id}`);
      setTimeout(() => router.push(`/records/${meta.record_id}`), 1200);
    } catch (e) {
      setStatus(`Error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-xl space-y-6">
      <h1 className="text-2xl font-semibold">Upload a land record</h1>
      <div className="card space-y-4">
        <label className="block">
          <span className="text-sm font-medium">Document (PDF or image)</span>
          <input
            type="file"
            accept={ACCEPT}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="mt-2 block w-full text-sm"
          />
        </label>
        {file && (
          <p className="text-sm text-brand-400">
            {file.name} · {(file.size / 1024).toFixed(1)} KB · {file.type}
          </p>
        )}
        <button
          className="btn-primary disabled:opacity-50"
          disabled={!file || busy}
          onClick={handleUpload}
        >
          {busy ? "Uploading …" : "Upload"}
        </button>
        {status && <p className="text-sm text-brand-700 font-mono">{status}</p>}
      </div>
      <p className="text-xs text-brand-400">
        The browser gets a presigned S3 URL from a Cognito-authorized Lambda,
        then PUTs directly to S3. Bytes never flow through API Gateway.
      </p>
    </div>
  );
}


