"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "./api";
import type { LedgerDraft, LedgerFilters, LedgerRow } from "./types";

const PAGE_SIZE = 100;

/** Ledger state for the grid.
 *
 * Mutations are applied to local state first and rolled back if the API rejects
 * them, so typing in a cell never waits on a round trip. `undo` keeps the last
 * delete in memory long enough for the toast to offer it back.
 */
export function useLedger(filters: LedgerFilters) {
  const [rows, setRows] = useState<LedgerRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Guards against a slow first page overwriting a newer filter's results.
  const requestId = useRef(0);
  const key = JSON.stringify(filters);

  const load = useCallback(async () => {
    const id = ++requestId.current;
    setLoading(true);
    setError(null);
    try {
      const page = await api.ledger({ ...filters, limit: PAGE_SIZE });
      if (id !== requestId.current) return;
      setRows(page.rows);
      setCursor(page.next_cursor);
    } catch (err) {
      if (id !== requestId.current) return;
      setError(err instanceof Error ? err.message : "Could not load the ledger");
    } finally {
      if (id === requestId.current) setLoading(false);
    }
    // filters is captured through `key`, which is what actually changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadMore = useCallback(async () => {
    if (!cursor || loading) return;
    setLoading(true);
    try {
      const page = await api.ledger({ ...filters, cursor, limit: PAGE_SIZE });
      setRows((current) => [...current, ...page.rows]);
      setCursor(page.next_cursor);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load more rows");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursor, loading, key]);

  const create = useCallback(async (draft: LedgerDraft) => {
    setSaving(true);
    setError(null);
    try {
      const created = await api.createLedgerRow(draft);
      setRows((current) =>
        [created, ...current].sort((a, b) => b.date.localeCompare(a.date)),
      );
      return created;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save that row");
      throw err;
    } finally {
      setSaving(false);
    }
  }, []);

  const update = useCallback(
    async (id: string, patch: Partial<LedgerDraft>) => {
      const before = rows.find((row) => row.id === id);
      if (!before) return;

      // Optimistic: show the edit immediately, reconcile with the server's
      // re-priced row (base_amount, fx_rate) when it answers.
      setRows((current) =>
        current.map((row) => (row.id === id ? { ...row, ...patch } as LedgerRow : row)),
      );
      setSaving(true);
      setError(null);
      try {
        const saved = await api.updateLedgerRow(id, patch);
        setRows((current) => current.map((row) => (row.id === id ? saved : row)));
        return saved;
      } catch (err) {
        setRows((current) => current.map((row) => (row.id === id ? before : row)));
        setError(err instanceof Error ? err.message : "Could not save that edit");
        throw err;
      } finally {
        setSaving(false);
      }
    },
    [rows],
  );

  const remove = useCallback(
    async (ids: string[]) => {
      const removed = rows.filter((row) => ids.includes(row.id));
      setRows((current) => current.filter((row) => !ids.includes(row.id)));
      setSaving(true);
      try {
        if (ids.length === 1) await api.deleteLedgerRow(ids[0]);
        else await api.deleteLedgerRows(ids);
      } catch (err) {
        setRows((current) =>
          [...removed, ...current].sort((a, b) => b.date.localeCompare(a.date)),
        );
        setError(err instanceof Error ? err.message : "Could not delete those rows");
        throw err;
      } finally {
        setSaving(false);
      }
      return removed;
    },
    [rows],
  );

  /** Re-create rows a delete removed. Ids change; nothing else does. */
  const restore = useCallback(async (removed: LedgerRow[]) => {
    const drafts: LedgerDraft[] = removed.map((row) => ({
      date: row.date,
      entry_type: row.entry_type,
      amount: Math.abs(row.amount),
      currency: row.currency,
      category_id: row.category_id,
      platform_id: row.platform_id,
      account_id: row.account_id,
      merchant: row.merchant,
      memo: row.memo,
      tags: row.tags,
      source: row.source,
      receipt_image_url: row.receipt_image_url,
      receipt_storage_path: row.receipt_storage_path,
      giving_arm: row.giving_arm,
      giving_recipient: row.giving_recipient,
    }));
    const restored = await api.createLedgerRows(drafts);
    setRows((current) =>
      [...restored, ...current].sort((a, b) => b.date.localeCompare(a.date)),
    );
  }, []);

  /** Splice a row created elsewhere (the OCR flow) into the grid. */
  const insert = useCallback((row: LedgerRow) => {
    setRows((current) =>
      [row, ...current.filter((r) => r.id !== row.id)].sort((a, b) =>
        b.date.localeCompare(a.date),
      ),
    );
  }, []);

  return {
    rows,
    loading,
    saving,
    error,
    hasMore: cursor != null,
    reload: load,
    loadMore,
    create,
    update,
    remove,
    restore,
    insert,
    clearError: () => setError(null),
  };
}
