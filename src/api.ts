export async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: 'no-store', ...options });
  const body = await response.json();
  if (!response.ok) throw new Error(typeof body?.error === 'string' ? body.error : 'Unable to complete request.');
  return body as T;
}
