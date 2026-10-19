import { useEffect, useState, type ReactElement } from 'react';

import {
  deleteResearchTask,
  getResearchTask,
  listResearchHistory,
  SerenaApiError,
} from '../app/api';
import type { ResearchResult, ResearchTaskDetail, ResearchTaskSummary } from '../app/types';
import { ResearchResult as ResearchResultView } from './ResearchResult';

interface ResearchHistoryProps {
  apiUrl: string;
  accessToken: string;
  refreshKey: number;
}

interface PageReadResult {
  finalUrl: string;
  title: string;
  text: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isResearchResult(value: unknown): value is ResearchResult {
  return (
    isRecord(value) &&
    Array.isArray(value.sources) &&
    Array.isArray(value.evidence) &&
    Array.isArray(value.findings)
  );
}

function isPageReadResult(value: unknown): value is PageReadResult {
  return (
    isRecord(value) &&
    typeof value.finalUrl === 'string' &&
    typeof value.title === 'string' &&
    typeof value.text === 'string'
  );
}

function getErrorMessage(error: unknown): string {
  return error instanceof SerenaApiError
    ? error.message
    : 'Serena could not load this history item. Check your connection and try again.';
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? 'Date unavailable' : date.toLocaleString();
}

function HistoryResult({ task }: { task: ResearchTaskDetail }): ReactElement {
  if (isResearchResult(task.result)) {
    return <ResearchResultView result={task.result} />;
  }
  if (isPageReadResult(task.result)) {
    return (
      <article className="history-detail__page">
        <h3>{task.result.title}</h3>
        <a href={task.result.finalUrl} target="_blank" rel="noreferrer">
          {task.result.finalUrl}
        </a>
        <p>{task.result.text}</p>
      </article>
    );
  }
  if (task.status === 'failed') {
    return (
      <div className="empty-panel">
        <strong>This task did not complete.</strong>
        <span>
          {task.errorCode ? `Recorded error code: ${task.errorCode}` : 'No result was saved.'}
        </span>
      </div>
    );
  }
  return (
    <div className="empty-panel">
      <strong>No result is available yet.</strong>
      <span>This task may still be running or may not have stored a result.</span>
    </div>
  );
}

function TaskRow({
  task,
  loading,
  disabled,
  pendingDelete,
  onOpen,
  onRequestDelete,
  onCancelDelete,
  onConfirmDelete,
}: {
  task: ResearchTaskSummary;
  loading: boolean;
  disabled: boolean;
  pendingDelete: boolean;
  onOpen: () => void;
  onRequestDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
}): ReactElement {
  return (
    <article className="history-item">
      <div className="history-item__topline">
        <span className={`history-status history-status--${task.status}`}>{task.status}</span>
        <time dateTime={task.createdAt}>{formatDate(task.createdAt)}</time>
      </div>
      <h3>{task.requestText}</h3>
      <p className="history-item__counts">
        {task.sourceCount} source{task.sourceCount === 1 ? '' : 's'} · {task.findingCount} finding
        {task.findingCount === 1 ? '' : 's'}
      </p>
      <div className="history-item__actions">
        <button className="secondary-button" type="button" onClick={onOpen} disabled={disabled}>
          {loading ? 'Loading…' : 'View result'}
        </button>
        {pendingDelete ? (
          <>
            <button
              className="danger-button"
              type="button"
              onClick={onConfirmDelete}
              disabled={disabled}
            >
              Confirm delete
            </button>
            <button
              className="text-button"
              type="button"
              onClick={onCancelDelete}
              disabled={disabled}
            >
              Cancel
            </button>
          </>
        ) : (
          <button
            className="text-button"
            type="button"
            onClick={onRequestDelete}
            disabled={disabled}
            aria-label={`Delete research task: ${task.requestText}`}
          >
            Delete
          </button>
        )}
      </div>
    </article>
  );
}

export function ResearchHistory({
  apiUrl,
  accessToken,
  refreshKey,
}: ResearchHistoryProps): ReactElement {
  const [items, setItems] = useState<ResearchTaskSummary[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);
  const [selectedTask, setSelectedTask] = useState<ResearchTaskDetail | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshCount, setRefreshCount] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setSelectedTask(null);
    setPendingDeleteId(null);
    void listResearchHistory({
      apiUrl,
      accessToken,
      limit: 20,
      offset: 0,
      signal: controller.signal,
    })
      .then((page) => {
        setItems(page.items);
        setHasMore(page.hasMore);
      })
      .catch((loadError: unknown) => {
        if (controller.signal.aborted) return;
        setError(getErrorMessage(loadError));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [apiUrl, accessToken, refreshKey, refreshCount]);

  async function openTask(taskId: string): Promise<void> {
    setBusyTaskId(taskId);
    setError(null);
    setSelectedTask(null);
    try {
      setSelectedTask(await getResearchTask({ apiUrl, accessToken, taskId }));
    } catch (loadError) {
      setError(getErrorMessage(loadError));
    } finally {
      setBusyTaskId(null);
    }
  }

  async function loadMore(): Promise<void> {
    setLoadingMore(true);
    setError(null);
    try {
      const page = await listResearchHistory({
        apiUrl,
        accessToken,
        limit: 20,
        offset: items.length,
      });
      setItems((current) => [...current, ...page.items]);
      setHasMore(page.hasMore);
    } catch (loadError) {
      setError(getErrorMessage(loadError));
    } finally {
      setLoadingMore(false);
    }
  }

  async function confirmDelete(taskId: string): Promise<void> {
    setBusyTaskId(taskId);
    setError(null);
    try {
      await deleteResearchTask({ apiUrl, accessToken, taskId });
      setItems((current) => current.filter((item) => item.id !== taskId));
      setSelectedTask((current) => (current?.id === taskId ? null : current));
      setPendingDeleteId(null);
    } catch (deleteError) {
      setError(getErrorMessage(deleteError));
    } finally {
      setBusyTaskId(null);
    }
  }

  return (
    <section className="history-panel" aria-labelledby="research-history-heading">
      <div className="history-panel__heading">
        <div>
          <p className="eyebrow">Your workspace</p>
          <h2 id="research-history-heading">Research history</h2>
          <p>Only tasks saved to your signed-in account appear here.</p>
        </div>
        <button
          className="secondary-button"
          type="button"
          onClick={() => setRefreshCount((count) => count + 1)}
          disabled={loading || loadingMore}
        >
          Refresh
        </button>
      </div>

      {error ? (
        <div className="history-error" role="alert">
          <span>{error}</span>
          <button
            className="text-button"
            type="button"
            onClick={() => setRefreshCount((count) => count + 1)}
          >
            Retry
          </button>
        </div>
      ) : null}

      {loading ? (
        <div className="loading-panel" aria-live="polite">
          Loading your research history…
        </div>
      ) : items.length === 0 && !error ? (
        <div className="empty-panel">
          <strong>No saved research yet.</strong>
          <span>Your completed and failed tasks will appear here after you run research.</span>
        </div>
      ) : (
        <div className="history-list">
          {items.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              loading={busyTaskId === task.id}
              disabled={busyTaskId !== null || loadingMore}
              pendingDelete={pendingDeleteId === task.id}
              onOpen={() => void openTask(task.id)}
              onRequestDelete={() => setPendingDeleteId(task.id)}
              onCancelDelete={() => setPendingDeleteId(null)}
              onConfirmDelete={() => void confirmDelete(task.id)}
            />
          ))}
        </div>
      )}

      {hasMore && !loading ? (
        <button
          className="secondary-button history-load-more"
          type="button"
          onClick={() => void loadMore()}
          disabled={loadingMore}
        >
          {loadingMore ? 'Loading…' : 'Load more'}
        </button>
      ) : null}

      {selectedTask ? (
        <section className="history-detail" aria-label="Saved research result">
          <div className="history-detail__heading">
            <div>
              <p className="eyebrow">Saved result</p>
              <h3>{selectedTask.requestText}</h3>
              <time dateTime={selectedTask.createdAt}>{formatDate(selectedTask.createdAt)}</time>
            </div>
            <button
              className="text-button"
              type="button"
              onClick={() => setSelectedTask(null)}
              aria-label="Close saved research result"
            >
              Close
            </button>
          </div>
          <HistoryResult task={selectedTask} />
        </section>
      ) : null}
    </section>
  );
}
