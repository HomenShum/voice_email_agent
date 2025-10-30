// Minimal client helper inspired by implementation_requirements_guide.md
export type SearchResult = {
  type: 'email' | 'thread';
  id: string;
  title: string;
  snippet?: string;
  thread_id?: string;
};

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8787';

const post = async <T>(path: string, body: unknown) => {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return (await res.json()) as T;
};

export async function searchEmails(req: {
  queries: { text: string; weight?: number }[];
  top_k?: number;
}) {
  return post<{ results: SearchResult[] }>(`/email/search`, req);
}

