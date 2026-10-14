import { BookOpen, ExternalLink, Play } from 'lucide-react';
import { SELF_HELP_VIDEO_URL } from '../config/selfHelp';
import { SectionHeader } from './ui/primitives';

export default function SelfHelp() {
  return (
    <section className="space-y-6">
      <SectionHeader
        eyebrow="Tutorial"
        title="Get familiar with PrimeHire"
        subtitle="Watch the walkthrough at your own pace. You can pause the video and return to the portal as you follow along."
        icon={<BookOpen className="h-5 w-5" />}
      />

      <a
        href={SELF_HELP_VIDEO_URL}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Watch the PrimeHire tutorial in Google Drive (opens in a new tab)"
        className="group grid overflow-hidden rounded-2xl border border-border/70 bg-card text-card-foreground shadow-[var(--shadow-card)] transition-shadow hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-4 lg:grid-cols-[1.3fr_1fr]"
      >
        <div className="relative aspect-video overflow-hidden bg-violet-950">
          <img
            src="/self-help-thumbnail.svg"
            alt=""
            width={960}
            height={540}
            className="h-full w-full object-cover"
          />
          <div className="absolute inset-0 flex items-center justify-center" aria-hidden="true">
            <span className="flex h-16 w-16 items-center justify-center rounded-full border border-white/50 bg-white text-violet-700 shadow-xl transition-transform group-hover:scale-110 group-focus-visible:scale-110 sm:h-20 sm:w-20 motion-reduce:transition-none">
              <Play className="h-7 w-7 translate-x-0.5 fill-current sm:h-8 sm:w-8" />
            </span>
          </div>
          <span className="absolute bottom-4 left-4 rounded-full border border-white/25 bg-violet-950/80 px-3 py-1 text-xs font-medium text-white sm:bottom-5 sm:left-5">
            Video tutorial
          </span>
        </div>

        <div className="flex flex-col justify-center gap-5 p-5 sm:p-8">
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-primary">Self Help</p>
            <h3 className="text-xl font-semibold tracking-tight sm:text-2xl">PrimeHire portal walkthrough</h3>
            <p className="text-sm leading-relaxed text-muted-foreground">
              A guided video to help you find your way around the portal and use its features with confidence.
            </p>
          </div>
          <div className="space-y-2">
            <span className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground">
              <Play className="h-4 w-4" aria-hidden="true" /> Watch tutorial
            </span>
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> Opens in Google Drive in a new tab
            </p>
          </div>
        </div>
      </a>
    </section>
  );
}
