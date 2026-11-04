import React, { useEffect, useRef, useState } from "react";
import { Sparkles, RefreshCw, Users, ArrowRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Modal } from "../ui/Modal";
import { AppSelect } from "../ui/AppSelect";
import {
  recruitmentRequest,
  formatTime,
  stageLabel,
  Person,
} from "../../lib/recruitmentApi";

type Run = {
  runId: string;
  jobId: string;
  status: string;
  createdAt: string;
  total: number;
  processed: number;
  skipped: number;
  failed: number;
  cursor: number;
  poolTotal: number;
  skip: number;
  maxCandidates: number;
  error?: string;
};
type Match = {
  matchId: string;
  candidate: Person;
  score: number;
  localScore: number;
  method: string;
  providerStatus: string;
  reasons: string[];
  cautions: string[];
  matchedSkills: string[];
  missingSkills: string[];
  stale: boolean;
  previousStage: string;
  previousAssessment: { score?: number };
  reviewCount: number;
};
type Evidence = {
  candidate: Person;
  previousApplicationId: string;
  previousAssessment: { score?: number };
  reviews: any[];
  rejection: any;
  timeline: any[];
  stale: boolean;
};

export function TalentPool({
  jobId,
  onReused,
}: {
  jobId: string;
  onReused: () => void;
}) {
  const [run, setRun] = useState<Run | null>(null);
  const [history, setHistory] = useState<Run[]>([]);
  const [moreHistory, setMoreHistory] = useState(false);
  const [matches, setMatches] = useState<Match[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [minimum, setMinimum] = useState(0);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [selected, setSelected] = useState<Match | null>(null);
  const [evidence, setEvidence] = useState<Evidence | null>(null);
  const [reason, setReason] = useState("");
  const [revision, setRevision] = useState(0);
  const requestKey = useRef("");
  const historyCount = useRef(0);
  historyCount.current = history.length;
  const running = !!run && ["queued", "running"].includes(run.status);

  useEffect(() => {
    setRun(null);
    setHistory([]);
    setMatches([]);
    setPage(0);
    setSelected(null);
    setError("");
    setMessage("");
    requestKey.current = "";
    if (!jobId) return;
    const controller = new AbortController();
    setLoading(true);
    let inFlight = false;
    const load = () => {
      if (inFlight) return;
      inFlight = true;
      void recruitmentRequest<{ items: Run[]; hasMore: boolean }>(
        `/talent/runs?jobId=${encodeURIComponent(jobId)}`,
        undefined,
        "GET",
        controller.signal,
      )
        .then((result) => {
          if (!controller.signal.aborted) {
            setRun((current) => current || result.items[0] || null);
            setHistory((current) => [
              ...result.items,
              ...current.filter(
                (old) => !result.items.some((row) => row.runId === old.runId),
              ),
            ]);
            if (historyCount.current <= 20) setMoreHistory(result.hasMore);
          }
        })
        .catch((e) => {
          if (!controller.signal.aborted) setError(e.message);
        })
        .finally(() => {
          inFlight = false;
          if (!controller.signal.aborted) setLoading(false);
        });
    };
    load();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, 5000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [jobId]);

  useEffect(() => {
    if (!run) return;
    const controller = new AbortController();
    let inFlight = false;
    async function refresh() {
      if (inFlight) return;
      inFlight = true;
      try {
        const [fresh, result] = await Promise.all([
          recruitmentRequest<Run>(
            `/talent/runs/${run!.runId}`,
            undefined,
            "GET",
            controller.signal,
          ),
          recruitmentRequest<{ items: Match[]; total: number }>(
            `/talent/matches?runId=${run!.runId}&minimum=${minimum}&skip=${page * 20}`,
            undefined,
            "GET",
            controller.signal,
          ),
        ]);
        if (!controller.signal.aborted) {
          setRun(fresh);
          setMatches(result.items);
          setTotal(result.total);
        }
      } catch (e: any) {
        if (!controller.signal.aborted) setError(e.message);
      } finally {
        inFlight = false;
      }
    }
    void refresh();
    const timer = setInterval(
      () => {
        if (document.visibilityState === "visible") void refresh();
      },
      running ? 5000 : 30000,
    );
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [run?.runId, running, page, minimum, revision]);

  async function start(skip = 0) {
    setBusy(true);
    setError("");
    setMessage("");
    requestKey.current ||= crypto.randomUUID();
    try {
      const result = await recruitmentRequest<Run>("/talent/runs", {
        jobId,
        requestId: requestKey.current,
        skip,
        maxCandidates: 100,
      });
      setRun(result);
      setHistory((current) => [
        result,
        ...current.filter((row) => row.runId !== result.runId),
      ]);
      setPage(0);
      setMatches([]);
      requestKey.current = "";
      setRevision((n) => n + 1);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  function open(match: Match) {
    setSelected(match);
    setEvidence(null);
    setReason("");
    setError("");
  }
  useEffect(() => {
    if (!selected) return;
    const controller = new AbortController();
    void recruitmentRequest<Evidence>(
      `/talent/matches/${selected.matchId}`,
      undefined,
      "GET",
      controller.signal,
    )
      .then((result) => {
        if (!controller.signal.aborted) setEvidence(result);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [selected?.matchId]);
  async function reuse() {
    if (!selected) return;
    setBusy(true);
    setError("");
    try {
      const result = await recruitmentRequest<{
        applicationId: string;
        currentStage: string;
      }>(`/talent/matches/${selected.matchId}/reuse`, { reason });
      setMessage(
        `Candidate is associated with this job at ${stageLabel(result.currentStage)}. No email was sent.`,
      );
      setSelected(null);
      onReused();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function olderRuns() {
    setBusy(true);
    setError("");
    try {
      const result = await recruitmentRequest<{
        items: Run[];
        hasMore: boolean;
      }>(
        `/talent/runs?jobId=${encodeURIComponent(jobId)}&skip=${history.length}`,
      );
      setHistory((current) => [
        ...current,
        ...result.items.filter(
          (row) => !current.some((old) => old.runId === row.runId),
        ),
      ]);
      setMoreHistory(result.hasMore);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-label="Intelligent talent pool" className="space-y-5">
      <div className="rounded-2xl border border-primary/25 bg-card p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-primary">
              <Sparkles className="h-4 w-4" />
              Rediscover previous candidates
            </p>
            <h2 className="mt-2 text-xl font-bold">
              A new opportunity, with context
            </h2>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              Compare this job with consented talent-pool profiles, assessment
              scores and historical interview feedback. Recommendations are
              advisory; you decide whom to bring forward.
            </p>
          </div>
          <Button
            disabled={!jobId || busy || running}
            onClick={() => void start()}
          >
            {busy ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="mr-2 h-4 w-4" />
            )}
            Compare talent pool
          </Button>
        </div>
        {!jobId && (
          <p className="mt-4 rounded-xl bg-muted p-4 text-sm">
            Choose a job above to see saved recommendations or compare previous
            candidates.
          </p>
        )}
        {run && (
          <div className="mt-5 rounded-xl border border-border p-4 text-sm">
            <div className="flex flex-wrap justify-between gap-2">
              <strong>
                {stageLabel(run.status)} · {run.cursor}/{run.total} profiles
                checked
              </strong>
              <span className="text-muted-foreground">
                {formatTime(run.createdAt)}
              </span>
            </div>
            <progress
              aria-label="Talent matching progress"
              className="mt-3 h-2 w-full accent-primary"
              value={run.cursor}
              max={Math.max(1, run.total)}
            />
            <p className="mt-2 text-xs text-muted-foreground">
              {run.processed} matched · {run.skipped} unavailable or
              permission-restricted · {run.failed} failed · {run.poolTotal}{" "}
              eligible historical profiles in scope
            </p>
            {run.error && <p className="mt-2 text-destructive">{run.error}</p>}
            {run.skip + run.total < run.poolTotal && !running && (
              <Button
                className="mt-3"
                variant="outline"
                disabled={busy}
                onClick={() => void start(run.skip + run.total)}
              >
                Compare next 100 profiles
              </Button>
            )}
          </div>
        )}
      </div>
      {!selected && error && (
        <p
          role="alert"
          className="rounded-xl bg-destructive/10 p-4 text-sm text-destructive"
        >
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="rounded-xl bg-primary/10 p-4 text-sm">
          {message}
        </p>
      )}
      {!!history.length && (
        <div className="flex flex-wrap items-end gap-3">
          <label className="min-w-56 flex-1 text-sm">
            Saved comparisons
            <AppSelect
              aria-label="Saved talent comparisons"
              value={run?.runId || ""}
              onValueChange={(id) => {
                setRun(history.find((row) => row.runId === id) || null);
                setPage(0);
                setMatches([]);
              }}
            >
              {history.map((row) => (
                <option key={row.runId} value={row.runId}>
                  {formatTime(row.createdAt)} · profiles {row.skip + 1}–
                  {row.skip + row.total}
                </option>
              ))}
            </AppSelect>
          </label>
          {moreHistory && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void olderRuns()}
            >
              Load older comparisons
            </Button>
          )}
        </div>
      )}
      {run && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <label className="flex items-center gap-2 text-sm">
            Minimum match %
            <Input
              aria-label="Minimum talent match"
              type="number"
              min={0}
              max={100}
              value={minimum}
              className="w-24"
              onChange={(e) => {
                setMinimum(Math.min(100, Math.max(0, Number(e.target.value))));
                setPage(0);
              }}
            />
          </label>
          <Button variant="outline" onClick={() => setRevision((n) => n + 1)}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh matches
          </Button>
        </div>
      )}
      {loading && <p role="status">Loading saved talent comparisons…</p>}
      {jobId && run && !matches.length && !loading && (
        <div className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          <Users className="mx-auto mb-3 h-6 w-6" />
          {running
            ? "Matching continues on the server. Results appear here as each profile finishes."
            : "No accessible candidates match this filter. Try a lower score or compare the talent pool again."}
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        {matches.map((match) => (
          <article
            key={match.matchId}
            className="rounded-2xl border border-border bg-card p-5"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-bold">{match.candidate.name}</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  Previously: {stageLabel(match.previousStage)} ·{" "}
                  {match.reviewCount} reviews
                </p>
              </div>
              <span className="rounded-xl bg-primary/15 px-3 py-2 text-xl font-bold">
                {match.score}%
              </span>
            </div>
            <p className="mt-3 text-xs font-semibold text-muted-foreground">
              {match.method === "llm"
                ? "AI comparison"
                : "Local comparison · " + stageLabel(match.providerStatus)}{" "}
              · Local score {match.localScore}/100
            </p>
            <p className="mt-3 text-sm">
              {match.candidate.skills?.join(" · ") || "Skills require review"}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              Previous assessment:{" "}
              {match.previousAssessment.score == null
                ? "Not available"
                : `${match.previousAssessment.score}/100`}
            </p>
            <ul className="mt-3 list-inside list-disc space-y-1 text-sm">
              {match.reasons.map((reason, i) => (
                <li key={i}>{reason}</li>
              ))}
            </ul>
            {!!match.missingSkills.length && (
              <p className="mt-3 text-xs text-muted-foreground">
                Skills to verify: {match.missingSkills.join(", ")}
              </p>
            )}
            {match.stale && (
              <p className="mt-3 text-sm font-semibold text-warning">
                Job or candidate evidence changed. Compare again before reuse.
              </p>
            )}
            <Button
              variant="outline"
              className="mt-4"
              onClick={() => void open(match)}
            >
              Review history & reuse
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </article>
        ))}
      </div>
      {run && total > 20 && (
        <div className="flex items-center justify-between gap-3 text-xs">
          <span>{total} matches</span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              disabled={!page}
              onClick={() => setPage((n) => n - 1)}
            >
              Previous matches
            </Button>
            <Button
              variant="outline"
              disabled={(page + 1) * 20 >= total}
              onClick={() => setPage((n) => n + 1)}
            >
              Next matches
            </Button>
          </div>
        </div>
      )}
      {selected && (
        <Modal
          label="Talent candidate history"
          onClose={() => setSelected(null)}
          dismissible={!busy}
          className="max-w-3xl p-5 sm:p-6"
        >
          <h2 className="pr-8 text-xl font-bold">
            {selected.candidate.name} · Previous journey
          </h2>
          {!evidence && !error && (
            <p role="status" className="mt-4">
              Loading permitted history…
            </p>
          )}
          {evidence && (
            <div className="mt-5 space-y-5">
              <p className="text-sm text-muted-foreground">
                {evidence.candidate.summary ||
                  "Review the historical evidence and reconfirm current availability."}
              </p>
              {evidence.rejection.reason && (
                <div className="rounded-xl bg-muted p-4 text-sm">
                  <strong>Previous rejection reason</strong>
                  <p className="mt-2 whitespace-pre-wrap">
                    {evidence.rejection.reason}
                  </p>
                </div>
              )}
              {evidence.reviews.map((review) => (
                <div
                  key={review.reviewId}
                  className="rounded-xl border border-border p-4 text-sm"
                >
                  <strong>
                    {stageLabel(review.round)} · {stageLabel(review.decision)}
                  </strong>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {formatTime(review.createdAt)}
                  </p>
                  <p className="mt-3 whitespace-pre-wrap">
                    Strengths: {review.strengths}
                  </p>
                  <p className="mt-2 whitespace-pre-wrap">
                    Concerns: {review.concerns || "None recorded"}
                  </p>
                  <p className="mt-2 whitespace-pre-wrap">{review.comments}</p>
                </div>
              ))}
              <details className="rounded-xl border border-border p-4">
                <summary className="cursor-pointer text-sm font-semibold">
                  Previous candidate roadmap
                </summary>
                <ol className="mt-3 space-y-3 text-sm">
                  {evidence.timeline.map((event) => (
                    <li key={event.historyId}>
                      <strong>{stageLabel(event.toStage)}</strong>
                      <p className="text-xs text-muted-foreground">
                        {formatTime(event.transitionAt)}
                      </p>
                      <p className="mt-1">{event.reason}</p>
                    </li>
                  ))}
                </ol>
              </details>
              <ul className="space-y-2 text-xs text-muted-foreground">
                {selected.cautions.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
              <label className="block text-sm font-semibold">
                Reason for considering this candidate
                <Textarea
                  aria-label="Talent reuse reason"
                  className="mt-2"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  minLength={3}
                  maxLength={500}
                />
              </label>
              <p className="text-xs text-muted-foreground">
                Reuses the same candidate and creates a separate application.
                Previous ATS and assessment scores remain historical; no
                interview or email is created automatically.
              </p>
            </div>
          )}
          {error && (
            <p role="alert" className="mt-4 text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="mt-6 flex justify-end gap-2">
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setSelected(null)}
            >
              Close
            </Button>
            <Button
              disabled={
                busy || !evidence || evidence.stale || reason.trim().length < 3
              }
              onClick={() => void reuse()}
            >
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Add to
              this job for review
            </Button>
          </div>
        </Modal>
      )}
    </section>
  );
}
