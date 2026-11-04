import React, { useEffect, useRef, useState } from "react";
import { CalendarPlus, Loader2 } from "lucide-react";
import {toast} from 'sonner';
import {googleRequest,CalendarAvailability} from '../../lib/googleApi';
import { Modal } from "../ui/Modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { AppSelect } from "../ui/AppSelect";
import {
  Application,
  Interview,
  Round,
  Staff,
  Page,
  recruitmentRequest,
  formatTime,
} from "../../lib/recruitmentApi";

const ROLE = {
  technical: "technical_interviewer",
  managerial: "managerial_interviewer",
  hr: "hr",
};
const localTime = (value: string) => {
  const d = new Date(new Date(value).getTime() + 330 * 60000);
  return d.toISOString().slice(0, 16);
};
export function ScheduleDialog({
  application,
  existing,
  onClose,
  onSaved,
}: {
  application: Application;
  existing?: Interview;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [round, setRound] = useState<Round>(
    existing?.round ||
      (application.currentStage.startsWith("ROUND2")
        ? "managerial"
        : application.currentStage === "HR_ROUND"
          ? "hr"
          : "technical"),
  );
  const [staff, setStaff] = useState<Staff[]>([]);
  const [selectedStaff, setSelectedStaff] = useState<Staff|null>(null);
  const [total, setTotal] = useState(0);
  const [skip, setSkip] = useState(0);
  const [search, setSearch] = useState("");
  const [interviewer, setInterviewer] = useState(existing?.interviewerId || "");
  const [start, setStart] = useState(
    existing ? localTime(existing.startsAt) : "",
  );
  const [end, setEnd] = useState(existing ? localTime(existing.endsAt) : "");
  const [meeting, setMeeting] = useState(existing?.meetingLink || "");
  const [location, setLocation] = useState(existing?.location || "");
  const [reminder, setReminder] = useState(existing?.reminderMinutes || 15);
  const [reason, setReason] = useState("");
  const [override, setOverride] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [calendar,setCalendar]=useState<CalendarAvailability|null>(null),[checking,setChecking]=useState(false);
  const calendarRequest = useRef<AbortController|null>(null);
  const assignedStaff = staff.find(person=>person.userId===interviewer) || (selectedStaff?.userId===interviewer?selectedStaff:null);
  const calendarConnected = !!assignedStaff?.googleCalendarConnected && calendar?.status!=='not_connected';
  const staffOptions = selectedStaff?.userId===interviewer&&!staff.some(person=>person.userId===interviewer)?[selectedStaff,...staff]:staff;
  useEffect(()=>{calendarRequest.current?.abort();setCalendar(null);setChecking(false);
    return()=>calendarRequest.current?.abort();
  },[interviewer,start,end]);
  async function checkCalendar(){
    if(!calendarConnected||!start||!end)return;
    calendarRequest.current?.abort();const controller=new AbortController();calendarRequest.current=controller;
    setChecking(true);setError('');try{
    const result=await googleRequest<CalendarAvailability>('/availability',{
      applicationId:application.applicationId,interviewerId:interviewer,
      startsAt:new Date(`${start}+05:30`).toISOString(),endsAt:new Date(`${end}+05:30`).toISOString(),
      ...(existing?{interviewId:existing.interviewId}:{}),
    },'POST',controller.signal);
    if(!controller.signal.aborted)setCalendar(result);
  }catch(cause){if(!controller.signal.aborted)setCalendar({status:'unavailable',available:null,message:cause instanceof Error?cause.message:'Calendar availability could not be verified'});}finally{if(!controller.signal.aborted)setChecking(false);}}
  const readyStages = {technical:['ASSESSMENT_COMPLETED','ROUND1_PENDING_ASSIGNMENT'],managerial:['ROUND2_PENDING_ASSIGNMENT'],hr:['HR_ROUND']};
  const needsException = !existing && !readyStages[round].includes(application.currentStage);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void recruitmentRequest<Page<Staff>&{selected?:Staff|null}>(
        `/staff?role=${ROLE[round]}&search=${encodeURIComponent(search)}&skip=${skip}&selectedUserId=${encodeURIComponent(interviewer)}`,
        undefined,
        "GET",
        controller.signal,
      )
        .then((p) => {
          if(controller.signal.aborted)return;
          setStaff(p.items);
          setSelectedStaff(p.selected||p.items.find(person=>person.userId===interviewer)||null);
          setTotal(p.total);
        })
        .catch((e) => {
          if (!controller.signal.aborted) setError(e.message);
        });
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [round, search, skip, interviewer]);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (needsException && override.trim().length < 10) {
      setError('Enter a manual exception reason of at least 10 characters to schedule from the current stage.');
      return;
    }
    setBusy(true);
    setError("");
    try {
      const body = {
        applicationId: application.applicationId,
        round,
        interviewerId: interviewer,
        startsAt: new Date(`${start}+05:30`).toISOString(),
        endsAt: new Date(`${end}+05:30`).toISOString(),
        meetingLink: meeting,
        location,
        reminderMinutes: reminder,
        reason,
        overrideReason: override,
        ...(existing ? { expectedRevision: existing.revision } : {}),
      };
      const result=await recruitmentRequest<Interview>(
        existing ? `/interviews/${existing.interviewId}` : "/interviews",
        body,
        existing ? "PUT" : "POST",
      );
      if(result.googleCalendarStatus==='synced')toast.success('Interview scheduled. Google Calendar event and reminder added.');
      else if(result.googleCalendarStatus&&!['not_configured','not_connected'].includes(result.googleCalendarStatus))toast.message('Interview saved. Google Calendar needs attention.',{description:result.googleCalendarError||'Calendar sync is pending. Open the interview to check its status.'});
      onSaved();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      label={existing ? "Reschedule interview" : "Schedule interview"}
      onClose={onClose}
      dismissible={!busy}
      className="max-w-2xl p-6"
    >
      <form onSubmit={save} className="space-y-5">
        <div className="flex items-center gap-3">
          <span className="rounded-xl bg-primary/15 p-3">
            <CalendarPlus className="h-5 w-5" />
          </span>
          <div>
            <h2 className="text-xl font-bold">
              {existing ? "Reschedule interview" : "Schedule an interview"}
            </h2>
            <p className="text-sm text-muted-foreground">
              {application.candidate?.name} ·{" "}
              {application.jobTitle || existing?.jobTitle}
            </p>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="space-y-2 text-sm font-medium">
            Interview round
            <AppSelect
              aria-label="Interview round"
              disabled={!!existing}
              value={round}
              onValueChange={(v) => {
                setRound(v as Round);
                setInterviewer("");
                setSkip(0);
              }}
            >
              <option value="technical">Technical</option>
              <option value="managerial">Managerial</option>
              <option value="hr">HR</option>
            </AppSelect>
          </label>
          <label className="space-y-2 text-sm font-medium">
            Reminder
            <AppSelect
              aria-label="Interview reminder"
              value={String(reminder)}
              onValueChange={(v) => setReminder(Number(v))}
            >
              {[10, 15, 20].map((m) => (
                <option key={m} value={m}>
                  {m} minutes before
                </option>
              ))}
            </AppSelect>
          </label>
        </div>
        <div className="rounded-xl border border-border p-4">
          <label className="text-sm font-medium">
            Find an interviewer
            <Input
              className="mt-2"
              placeholder="Search by name"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setSkip(0);
              }}
            />
          </label>
          <label className="mt-3 block text-sm font-medium">
            Assigned interviewer
            <AppSelect
              aria-label="Assigned interviewer"
              value={interviewer}
              onValueChange={setInterviewer}
            >
              <option value="">Choose an active interviewer</option>
              {staffOptions.map((s) => (
                <option key={s.userId} value={s.userId}>
                  {s.name}{s.googleCalendarConnected?' · Google Calendar connected':''}
                </option>
              ))}
            </AppSelect>
          </label>
          {interviewer&&assignedStaff&&<p role="status" className="mt-3 text-xs text-muted-foreground">
            {assignedStaff.name}{calendarConnected?' has connected Google Calendar.':' has not connected Google Calendar. You can schedule manually; they can connect it later.'}
          </p>}
          <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
            <span>
              {total} matching accounts · invite new people through Team &
              Access
            </span>
            <span className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={!skip}
                onClick={() => setSkip((n) => n - 50)}
              >
                Previous
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={skip + 50 >= total}
                onClick={() => setSkip((n) => n + 50)}
              >
                Next
              </Button>
            </span>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="space-y-2 text-sm font-medium">
            Starts at · IST
            <Input
              aria-label="Interview starts"
              type="datetime-local"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              required
            />
          </label>
          <label className="space-y-2 text-sm font-medium">
            Ends at · IST
            <Input
              aria-label="Interview ends"
              type="datetime-local"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              required
            />
          </label>
        </div>
        {calendarConnected&&<section aria-label="Google Calendar availability" className="space-y-3 rounded-xl border border-border bg-muted/20 p-4 text-sm">
          <h3 className="font-medium">{assignedStaff?.name}’s Google Calendar</h3>
          <p className="text-xs text-muted-foreground">Only overlapping meetings block this time. We check again when you save and add a calendar event with your selected reminder when available.</p>
          <Button type="button" variant="outline" disabled={busy||checking||!interviewer||!start||!end} onClick={()=>void checkCalendar()}>{checking&&<Loader2 className="size-4 animate-spin"/>}{checking?'Checking availability…':'Check availability'}</Button>
          {calendar&&<p role="status" className={calendar.available===false||calendar.status==='unavailable'?'text-destructive':'text-muted-foreground'}>{calendar.message}</p>}
        </section>}
        <label className="block space-y-2 text-sm font-medium">
          Meeting link
          <Input
            type="url"
            placeholder="https://meet.google.com/..."
            value={meeting}
            onChange={(e) => setMeeting(e.target.value)}
            maxLength={500}
          />
        </label>
        <label className="block space-y-2 text-sm font-medium">
          Location / joining instructions
          <Input
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            maxLength={200}
          />
        </label>
        <label className="block space-y-2 text-sm font-medium">
          {existing ? 'Reason for rescheduling' : 'Reason for scheduling'}
          <Textarea
            aria-label={existing ? 'Rescheduling reason' : 'Scheduling reason'}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            minLength={3}
            maxLength={500}
            required
          />
          {existing&&<span className="block text-xs font-normal text-muted-foreground">Explain why the time or interviewer is changing. This reason is saved in the interview history.</span>}
        </label>
        {needsException && (
          <details open className="rounded-xl border border-primary/30 bg-primary/5 p-4 text-sm">
            <summary className="cursor-pointer text-muted-foreground">
              Manual exception for a candidate not yet ready for this round
            </summary>
            <p className="my-2 text-xs text-muted-foreground">
              Current stage: {application.currentStage.replaceAll('_',' ')}. This
              candidate is outside the normal sequence for the selected round.
              Record why you are proceeding; the reason appears in the timeline.
            </p>
            <Textarea
              aria-label="Manual exception reason"
              placeholder="Explain why you are scheduling outside the normal sequence"
              value={override}
              onChange={(e) => setOverride(e.target.value)}
              maxLength={500}
              minLength={10}
              required
            />
          </details>
        )}
        {error && (
          <p
            role="alert"
            className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive"
          >
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={busy || !interviewer}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {existing ? "Save new schedule" : "Schedule interview"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
