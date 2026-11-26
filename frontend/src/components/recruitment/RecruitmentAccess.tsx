import React, { useEffect, useState } from "react";
import { ShieldCheck, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { AppSelect } from "../ui/AppSelect";
import { Staff, Page, Job, recruitmentRequest } from "../../lib/recruitmentApi";
const LABELS: Record<string, string> = {
  skills: "Skills",
  experience: "Experience and role",
  education: "Education",
  summary: "Resume summary",
  assessment: "Assessment result",
  resume: "Original resume download",
  previousReviews: "Previous round reviews",
  compensation: "Compensation (HR only)",
  contact: "Audited contact reveal",
};
export function RecruitmentAccess() {
  const [staff, setStaff] = useState<Staff[]>([]);
  const [search, setSearch] = useState("");
  const [skip, setSkip] = useState(0);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState("");
  const [profile, setProfile] = useState<any>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [jobSkip, setJobSkip] = useState(0);
  const [jobTotal, setJobTotal] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void recruitmentRequest<Page<Job>>(`/jobs?skip=${jobSkip}&limit=50`, undefined, 'GET', controller.signal)
      .then(result => {setJobs(result.items);setJobTotal(result.total);})
      .catch(cause => {if(!controller.signal.aborted)setError(cause.message);});
    return () => controller.abort();
  }, [jobSkip]);
  useEffect(() => {
    const controller = new AbortController();
    void recruitmentRequest<Page<Staff>>(
      `/staff?search=${encodeURIComponent(search)}&skip=${skip}`,
      undefined,
      "GET",
      controller.signal,
    )
      .then((p) => {
        setStaff(p.items);
        setTotal(p.total);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [search, skip]);
  useEffect(() => {
    setProfile(null);
    if (!selected) return;
    const c = new AbortController();
    void recruitmentRequest(`/access/${selected}`, undefined, "GET", c.signal)
      .then(setProfile)
      .catch((e) => {
        if (!c.signal.aborted) setError(e.message);
      });
    return () => c.abort();
  }, [selected]);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      setProfile(
        await recruitmentRequest(
          `/access/${selected}`,
          {
            visibleFields: profile.visibleFields,
            portalName: profile.portalName || '',
            reviewJobIds: profile.reviewJobIds || [],
            expectedRevision: profile.revision,
            reason,
          },
          "PUT",
        ),
      );
      setNotice("Interview visibility updated and audited.");
      setReason("");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="space-y-5 rounded-2xl border border-border bg-card p-6">
      <div className="flex flex-wrap justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-bold">
            <ShieldCheck className="h-5 w-5 text-primary" />
            Interviewer access
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Choose candidate visibility and assign developers jobs to review before interviews.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => window.dispatchEvent(new Event("elite:manage-team"))}
        >
          <UserPlus className="mr-2 h-4 w-4" />
          Invitations & accounts
        </Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Input
          aria-label="Find staff for access"
          placeholder="Find an interviewer by name"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setSkip(0);
          }}
        />
        <AppSelect
          aria-label="Interviewer access profile"
          value={selected}
          onValueChange={setSelected}
        >
          <option value="">Choose an interviewer / HR account</option>
          {staff.map((s) => (
            <option key={s.userId} value={s.userId}>
              {s.name} · {s.role.replaceAll("_", " ")}
            </option>
          ))}
        </AppSelect>
      </div>
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{total} accounts</span>
        <span className="flex gap-2">
          <Button
            variant="ghost"
            size="sm"
            disabled={!skip}
            onClick={() => setSkip((n) => n - 50)}
          >
            Previous
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={skip + 50 >= total}
            onClick={() => setSkip((n) => n + 50)}
          >
            Next
          </Button>
        </span>
      </div>
      {profile && (
        <form onSubmit={save} className="space-y-4">
          <label className="block text-sm">Portal name<Input aria-label="Portal name" placeholder="Frontend Developer" maxLength={80} value={profile.portalName || ''} onChange={e=>setProfile({...profile,portalName:e.target.value})}/></label>
          {staff.find(person=>person.userId===selected)?.role==='technical_interviewer'&&<fieldset className="space-y-3"><legend className="font-semibold">Jobs for assessment review</legend><p className="text-sm text-muted-foreground">Selected jobs require developer shortlisting before the first technical interview.</p>
            {jobs.map(job=><label key={job.jobId} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={(profile.reviewJobIds||[]).includes(job.jobId)} onChange={e=>setProfile({...profile,reviewJobIds:e.target.checked?[...(profile.reviewJobIds||[]),job.jobId]:(profile.reviewJobIds||[]).filter((id:string)=>id!==job.jobId)})}/>{job.title}</label>)}
            <div className="flex gap-2"><Button type="button" variant="outline" disabled={!jobSkip} onClick={()=>setJobSkip(n=>n-50)}>Previous jobs</Button><Button type="button" variant="outline" disabled={jobSkip+50>=jobTotal} onClick={()=>setJobSkip(n=>n+50)}>Next jobs</Button></div>
          </fieldset>}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Object.entries(LABELS).map(([key, label]) => (
              <label
                key={key}
                className={`flex items-start gap-3 rounded-xl border p-4 text-sm ${profile.visibleFields.includes(key) ? "border-primary/40 bg-primary/10" : "border-border"}`}
              >
                <input
                  className="mt-0.5 accent-current"
                  type="checkbox"
                  checked={profile.visibleFields.includes(key)}
                  onChange={(e) =>
                    setProfile((p: any) => ({
                      ...p,
                      visibleFields: e.target.checked
                        ? [...p.visibleFields, key]
                        : p.visibleFields.filter((v: string) => v !== key),
                    }))
                  }
                />
                {label}
              </label>
            ))}
          </div>
          <label className="block text-sm">
            Reason for permission change
            <Textarea
              aria-label="Access change reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              required
              minLength={3}
              maxLength={500}
            />
          </label>
          <Button type="submit" disabled={busy}>
            Save interview access
          </Button>
        </form>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-sm">
          {notice}
        </p>
      )}
    </section>
  );
}
