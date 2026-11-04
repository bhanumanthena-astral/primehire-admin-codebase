import React from "react";
import { ChevronLeft, ChevronRight, CalendarDays, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Interview, dateKey } from "../../lib/recruitmentApi";

export function RecruitmentCalendar({
  month,
  onMonth,
  items,
  onOpen,
}: {
  month: string;
  onMonth: (s: string) => void;
  items: Interview[];
  onOpen: (i: Interview) => void;
}) {
  const [year, m] = month.split("-").map(Number);
  const first = new Date(Date.UTC(year, m - 1, 1));
  const count = new Date(Date.UTC(year, m, 0)).getUTCDate();
  const offset = (first.getUTCDay() + 6) % 7;
  const today = dateKey(new Date().toISOString());
  const shift = (delta: number) => {
    const d = new Date(Date.UTC(year, m - 1 + delta, 1));
    onMonth(
      `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`,
    );
  };
  return (
    <section
      aria-label="Shared interview calendar"
      className="overflow-hidden rounded-2xl border border-border bg-card"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-5">
        <div className="flex items-center gap-3">
          <CalendarDays className="h-5 w-5 text-primary" />
          <div>
            <h2 className="font-bold">Shared interview calendar</h2>
            <p className="text-xs text-muted-foreground">
              All times in IST · your authorized interviews
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            aria-label="Previous month"
            onClick={() => shift(-1)}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Input
            aria-label="Calendar month"
            type="month"
            value={month}
            onChange={(e) => {
              if (e.target.value) onMonth(e.target.value);
            }}
            className="w-40"
          />
          <Button
            variant="outline"
            size="icon"
            aria-label="Next month"
            onClick={() => shift(1)}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <div className="hidden sm:block">
        <div className="grid grid-cols-7 border-b border-border">
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
            <div
              key={d}
              className="p-3 text-center text-xs font-semibold text-muted-foreground"
            >
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {Array.from({ length: offset }, (_, i) => (
            <div
              key={`blank${i}`}
              className="min-h-28 border-b border-r border-border/60 bg-muted/20"
            />
          ))}
          {Array.from({ length: count }, (_, i) => {
            const key = `${month}-${String(i + 1).padStart(2, "0")}`;
            const events = items.filter(
              (item) =>
                dateKey(item.startsAt) === key && item.status !== "cancelled",
            );
            return (
              <div
                key={key}
                className="min-h-28 min-w-0 border-b border-r border-border/60 p-2"
              >
                <span
                  className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold ${today === key ? "bg-primary text-primary-foreground" : ""}`}
                >
                  {i + 1}
                </span>
                <div className="mt-1 space-y-1">
                  {events.map((item) => (
                    <button
                      type="button"
                      key={item.interviewId}
                      onClick={() => onOpen(item)}
                      className="w-full rounded-md bg-primary/10 px-2 py-1.5 text-left text-xs text-foreground transition hover:bg-primary/20 focus-visible:outline-2 focus-visible:outline-ring"
                    >
                      <span className="block truncate font-semibold">
                        {item.candidate.name}
                      </span>
                      <span className="block truncate text-[0.6875rem]">
                        {new Intl.DateTimeFormat("en-IN", {
                          timeZone: "Asia/Kolkata",
                          hour: "numeric",
                          minute: "2-digit",
                        }).format(new Date(item.startsAt))}{" "}
                        · {item.round}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="space-y-2 p-4 sm:hidden">
        {items
          .filter((i) => i.status !== "cancelled")
          .map((item) => (
            <button
              type="button"
              key={item.interviewId}
              onClick={() => onOpen(item)}
              className="flex w-full items-center gap-3 rounded-xl border border-border p-3 text-left"
            >
              <Clock className="h-4 w-4 shrink-0 text-primary" />
              <span className="min-w-0">
                <strong className="block truncate text-sm">
                  {item.candidate.name}
                </strong>
                <span className="text-xs text-muted-foreground">
                  {dateKey(item.startsAt)} · {item.round} ·{" "}
                  {new Intl.DateTimeFormat("en-IN", {
                    timeZone: "Asia/Kolkata",
                    hour: "numeric",
                    minute: "2-digit",
                  }).format(new Date(item.startsAt))}
                </span>
              </span>
            </button>
          ))}
      </div>
      {!items.length && (
        <p className="p-8 text-center text-sm text-muted-foreground">
          No interviews scheduled this month.
        </p>
      )}
    </section>
  );
}
