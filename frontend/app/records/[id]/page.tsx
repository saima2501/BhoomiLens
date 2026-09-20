"use client";

import Link from "next/link";
import useSWR from "swr";
import { useState } from "react";
import { api, Record } from "@/lib/api";
import { DocumentViewer } from "@/components/DocumentViewer";
import { FieldRow } from "@/components/FieldRow";
import { StatusBadge } from "@/components/StatusBadge";
import { ConfidenceBadge } from "@/components/ConfidenceBadge";
import { ValidationFlagsList } from "@/components/ValidationFlagsList";
import { OfficialPortalButton } from "@/components/OfficialPortalButton";

const FIELDS: [string, string, "text" | "number"][] = [
  ["Owner", "owner_name", "text"],
  ["Father/Spouse", "father_or_spouse_name", "text"],
  ["Khasra", "khasra_number", "text"],
  ["Khata", "khata_number", "text"],
  ["Plot", "plot_number", "text"],
  ["Area", "area", "number"],
  ["Area unit", "area_unit", "text"],
  ["Village", "village", "text"],
  ["Tehsil", "tehsil", "text"],
  ["District", "district", "text"],
  ["State", "state", "text"],
  ["Classification", "land_classification", "text"],
  ["Ownership", "ownership_type", "text"],
  ["Mutation date", "mutation_date", "text"],
  ["Registration #", "registration_number", "text"],
];

export default function RecordDetailPage({ params }: { params: { id: string } }) {
  const { data, error, isLoading, mutate } = useSWR<Record>(
    ["record", params.id],
    () => api.getRecord(params.id),
  );
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function updateField(field: string, newValue: string | number) {
    const updated = await api.updateRecord(params.id, { [field]: newValue });
    mutate(updated, { revalidate: false });
    setNotice(
      `Revalidated → ${updated.validation_status} · confidence ${updated.overall_confidence.toFixed(0)}`,
    );
  }

  async function approve() {
    setBusy(true);
    try {
      const updated = await api.approve(params.id, "Verified against official portal");
      mutate(updated, { revalidate: false });
      setNotice("Approved — audit entry written.");
    } finally {
      setBusy(false);
    }
  }

  async function reject() {
    const reason = window.prompt("Reason for rejection?");
    if (!reason) return;
    setBusy(true);
    try {
      const updated = await api.reject(params.id, reason);
      mutate(updated, { revalidate: false });
      setNotice("Rejected.");
    } finally {
      setBusy(false);
    }
  }

  if (isLoading || !data) return <p>Loading …</p>;
  if (error) return <p className="text-risk-high">Failed to load: {String(error)}</p>;

  const editable =
    data.validation_status === "NEEDS_REVIEW" ||
    data.validation_status === "HIGH_RISK" ||
    data.validation_status === "PENDING";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs font-mono text-brand-400">{data.record_id}</div>
          <h1 className="text-2xl font-semibold">
            {data.owner_name ?? "Unknown owner"}
          </h1>
          <div className="mt-2 flex gap-3 items-center">
            <StatusBadge status={data.validation_status} />
            <ConfidenceBadge value={data.overall_confidence} />
            <Link
              href={`/records/${data.record_id}/audit`}
              className="text-xs underline text-brand-600"
            >
              View audit history
            </Link>
          </div>
        </div>
        <div className="flex gap-2">
          {editable && (
            <>
              <button
                className="btn-primary disabled:opacity-50"
                disabled={busy}
                onClick={approve}
              >
                Approve
              </button>
              <button
                className="btn-danger disabled:opacity-50"
                disabled={busy}
                onClick={reject}
              >
                Reject
              </button>
            </>
          )}
        </div>
      </div>

      {notice && (
        <div className="card text-sm text-brand-700">{notice}</div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <section className="card lg:col-span-3">
          <h2 className="text-sm uppercase tracking-wide text-brand-400 mb-3">
            Original document
          </h2>
          <DocumentViewer
            url={data.document_url}
            contentType={data.document_content_type}
          />
        </section>

        <section className="card lg:col-span-2">
          <h2 className="text-sm uppercase tracking-wide text-brand-400 mb-3">
            Extracted fields
          </h2>
          <div>
            {FIELDS.map(([label, key]) => (
              <FieldRow
                key={key}
                label={label}
                fieldKey={key}
                value={(data as any)[key]}
                confidence={data.field_confidence?.[key]}
                editable={editable}
                onSave={updateField}
              />
            ))}
          </div>
        </section>
      </div>

      <section className="card">
        <h2 className="text-sm uppercase tracking-wide text-brand-400 mb-3">
          Validation
        </h2>
        <ValidationFlagsList flags={data.validation_flags} />
      </section>

      <section className="card">
        <h2 className="text-sm uppercase tracking-wide text-brand-400 mb-3">
          Official-source verification
        </h2>
        <OfficialPortalButton portal={data.official_portal} />
      </section>
    </div>
  );
}
