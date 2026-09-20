"use client";

import useSWR from "swr";
import { api, DashboardMetrics } from "@/lib/api";

const fetcher = () => api.dashboard();

function StatCard({ label, value, tone }: { label: string; value: string | number; tone?: string }) {
  return (
    <div className="card">
      <div className="text-xs uppercase tracking-wide text-brand-400">{label}</div>
      <div className={`mt-2 text-3xl font-semibold ${tone ?? "text-brand-700"}`}>{value}</div>
    </div>
  );
}

export default function DashboardPage() {
  const { data, error, isLoading } = useSWR<DashboardMetrics>("dashboard", fetcher, {
    refreshInterval: 15000,
  });

  if (error) return <p className="text-risk-high">Failed to load metrics: {String(error)}</p>;
  if (isLoading || !data) return <p>Loading metrics …</p>;

  const avgPct = (data.average_extraction_confidence * 100).toFixed(1);

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold">Dashboard</h1>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Total documents" value={data.total_documents} />
        <StatCard label="Auto-approved" value={data.auto_approved} tone="text-risk-low" />
        <StatCard label="Human-approved" value={data.human_approved} tone="text-risk-low" />
        <StatCard label="Needs review" value={data.needs_review} tone="text-risk-medium" />
        <StatCard label="High risk" value={data.high_risk} tone="text-risk-high" />
        <StatCard label="Pending" value={data.pending} />
        <StatCard label="Rejected" value={data.rejected} />
        <StatCard label="Avg extraction confidence" value={`${avgPct}%`} />
      </div>

      <section className="card">
        <h2 className="text-lg font-semibold text-brand-700">Validation issues (real counts)</h2>
        {Object.keys(data.validation_issues).length === 0 ? (
          <p className="mt-2 text-brand-400">No issues recorded yet.</p>
        ) : (
          <ul className="mt-4 divide-y divide-brand-100">
            {(Object.entries(data.validation_issues) as [string, number][])
              .sort((a, b) => b[1] - a[1])
              .map(([kind, count]) => (
                <li key={kind} className="py-2 flex justify-between">
                  <span className="font-mono text-sm">{kind}</span>
                  <span className="font-semibold">{count}</span>
                </li>
              ))}
          </ul>
        )}
        <p className="mt-4 text-xs text-brand-400">
          Numbers are computed live from a bounded DynamoDB scan of the records
          table. No hardcoded accuracy metrics are displayed here.
        </p>
      </section>
    </div>
  );
}
