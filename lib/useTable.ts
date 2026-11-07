'use client';

import { useCallback, useEffect, useState } from 'react';

async function request(url: string, method: string, body?: unknown) {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `request failed (${res.status})`);
  return data;
}

export function useTable<T extends { id: string }>(
  table: string,
  orderBy = 'created_at',
  ascending = false
) {
  const [rows, setRows] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const data = await request(
        `/api/db/${table}?order=${encodeURIComponent(orderBy)}&dir=${ascending ? 'asc' : 'desc'}`,
        'GET'
      );
      setError(null);
      setRows(data.rows as T[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'load failed');
    }
    setLoading(false);
  }, [table, orderBy, ascending]);

  useEffect(() => {
    reload();
    window.addEventListener('focus', reload);
    return () => window.removeEventListener('focus', reload);
  }, [reload]);

  const insert = useCallback(
    async (values: Record<string, unknown>) => {
      await request(`/api/db/${table}`, 'POST', values);
      await reload();
    },
    [table, reload]
  );

  const update = useCallback(
    async (id: string, values: Record<string, unknown>) => {
      await request(`/api/db/${table}?id=${encodeURIComponent(id)}`, 'PATCH', values);
      await reload();
    },
    [table, reload]
  );

  const remove = useCallback(
    async (id: string) => {
      await request(`/api/db/${table}?id=${encodeURIComponent(id)}`, 'DELETE');
      await reload();
    },
    [table, reload]
  );

  return { rows, loading, error, reload, insert, update, remove };
}

export function todayISO(): string {
  const d = new Date();
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60_000).toISOString().slice(0, 10);
}