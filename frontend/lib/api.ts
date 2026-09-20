import { fetchAuthSession } from "aws-amplify/auth";

const API = process.env.NEXT_PUBLIC_API_ENDPOINT!;

async function authHeaders(): Promise<HeadersInit> {
  const session = await fetchAuthSession();
  const token = session.tokens?.idToken?.toString();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function req<T = unknown>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = {
    "Content-Type": "application/json",
    ...(await authHeaders()),
    ...(init.headers ?? {}),
  };
  const res = await fetch(`${API}${path}`, { ...init, headers });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${body}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export type ValidationFlag = {
  issue_type: string;
  severity: "HIGH" | "MEDIUM" | "LOW";
  field?: string;
  expected?: string | number;
  observed?: string | number;
  expected_unit?: string;
  observed_unit?: string;
  reference_id?: string;
  message: string;
};

export type Record = {
  record_id: string;
  document_id: string;
  validation_status:
    | "PENDING"
    | "AUTO_APPROVED"
    | "NEEDS_REVIEW"
    | "HIGH_RISK"
    | "HUMAN_APPROVED"
    | "REJECTED";
  overall_confidence: number;
  validation_flags: ValidationFlag[];
  owner_name?: string;
  father_or_spouse_name?: string;
  khasra_number?: string;
  khata_number?: string;
  area?: number;
  area_unit?: string;
  village?: string;
  tehsil?: string;
  district?: string;
  state?: string;
  document_url?: string;
  document_content_type?: string;
  field_confidence?: { [key: string]: number };
  official_portal?: {
    state?: string;
    label?: string;
    url?: string;
    cadastral_map_url?: string | null;
  };
  created_at?: string;
  updated_at?: string;
};

export type DashboardMetrics = {
  total_documents: number;
  auto_approved: number;
  human_approved: number;
  needs_review: number;
  high_risk: number;
  pending: number;
  rejected: number;
  average_extraction_confidence: number;
  validation_issues: { [key: string]: number };
  generated_at: string;
};

export type AuditEntry = {
  record_id: string;
  timestamp: string;
  action: string;
  user: string;
  field?: string;
  old_value?: string;
  new_value?: string;
  note?: string;
};

export const api = {
  requestUpload: (payload: { filename: string; content_type: string; size_bytes: number }) =>
    req<{ document_id: string; record_id: string; upload_url: string; expires_in: number }>(
      "/documents/upload",
      { method: "POST", body: JSON.stringify(payload) },
    ),
  listRecords: (status?: string) =>
    req<{ items: Record[] }>(
      `/records${status ? `?status=${encodeURIComponent(status)}` : ""}`,
    ),
  getRecord: (id: string) => req<Record>(`/records/${encodeURIComponent(id)}`),
  updateRecord: (id: string, changes: Partial<Record>) =>
    req<Record>(`/records/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify(changes),
    }),
  approve: (id: string, note?: string) =>
    req<Record>(`/records/${encodeURIComponent(id)}/approve`, {
      method: "POST",
      body: JSON.stringify({ note: note ?? "" }),
    }),
  reject: (id: string, reason?: string) =>
    req<Record>(`/records/${encodeURIComponent(id)}/reject`, {
      method: "POST",
      body: JSON.stringify({ reason: reason ?? "" }),
    }),
  revalidate: (id: string) =>
    req<Record>(`/records/${encodeURIComponent(id)}/revalidate`, { method: "POST" }),
  reviewQueue: () => req<{ items: Record[] }>("/review-queue"),
  dashboard: () => req<DashboardMetrics>("/dashboard/metrics"),
  audit: (id: string) => req<{ items: AuditEntry[] }>(`/records/${encodeURIComponent(id)}/audit`),
};
