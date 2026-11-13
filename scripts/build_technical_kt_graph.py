"""Build the source-linked KT map; curated explanations require human refresh."""
import ast
import hashlib
import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / '.ua'

# Evidence IDs stay stable across document, graph, and guided tour.
SOURCES = [
 ('C01','frontend/src/components/CreateJobForm.tsx','Create a job','UI validates the draft and calls createJob; an uploaded JD is a suggestion until the human submits.','ui'),
 ('C02','frontend/src/lib/hiringApi.ts','Hiring HTTP client','Sends job JSON and optional Idempotency-Key; converts failed HTTP responses to visible errors.','ui'),
 ('C03','frontend/src/lib/authFetch.ts','Authenticated fetch','Adds the in-memory access token; shares one refresh promise and retries an unauthorized request once.','security'),
 ('C04','frontend/cloudflare/worker.js','Cloudflare Pages gateway','Streams same-origin /api requests to BACKEND_ORIGIN, preserving uploads, auth, idempotency headers and cookies.','edge'),
 ('C05','backend/app/main.py','FastAPI application','Registers native API routers, startup validation and middleware; separates request handling from worker entry points.','api'),
 ('C06','backend/app/security/deps.py','Authentication and permissions','Verifies token, user/session context and permission dependencies; resource-specific checks still apply.','security'),
 ('C07','backend/app/security/job_permissions.py','Job access rules','Enforces role, organization, assigned-owner and explicit job access at the resource boundary.','security'),
 ('C08','backend/app/api/hiring.py','Jobs and application routes','Validates a job, resolves its active assignee, normalizes dates, persists it, records audit and notifies the owner.','api'),
 ('C09','backend/app/models/hiring.py','Domain repositories','Repository operations for jobs, applicants, applications, stage history and audit; logical collections are not interchangeable.','data'),
 ('C10','backend/app/db/mongodb.py','Database selector','Defaults to shared Motor/MongoDB; DATABASE_BACKEND=postgresql selects the PostgreSQL compatibility adapter instead.','data'),
 ('C11','backend/app/db/postgres.py','PostgreSQL document adapter','Keeps document-shaped repositories over one JSONB table per domain, pooled SQL connections and conditional writes with transaction locks.','data'),
 ('C12','backend/app/db/postgres_query.py','Document query compiler','Translates supported document filters and aggregation operations into SQL-side queries; it is a compatibility layer, not a fully normalized relational redesign.','data'),
 ('C13','frontend/src/components/ResumeIntakePage.tsx','Resume intake workspace','Selects job, consent and files; submits bounded chunks, shows received batches, polls status and exposes human ATS-band review.','ui'),
 ('C14','frontend/src/lib/resumeBulkUpload.ts','Bulk upload coordinator','Accepts up to 1000 files, sends at most ten per request sequentially, and derives stable chunk keys for retries.','ui'),
 ('C15','frontend/src/lib/resumeIntakeApi.ts','Multipart upload client','Creates FormData with job/mode/source/consent/files and Idempotency-Key; a response is upload acceptance, not completed parsing.','ui'),
 ('C16','backend/app/security/resume_intake_admission.py','Upload admission middleware','Authenticates before multipart handling, caps the body, claims bounded upload slots and checks free-profile resource headroom.','security'),
 ('C17','backend/app/api/resume_intake.py','Resume intake routes','Returns 202 for accepted uploads and exposes batches, review, ATS ranges, confirmation, retries and authorized downloads.','api'),
 ('C18','backend/app/services/resume_intake.py','Durable upload intake','Streams originals to private storage, hashes them, reserves capacity, saves the batch and creates a durable import job.','services'),
 ('C19','backend/app/services/storage.py','Private file storage','Uses generated storage keys and safe path resolution; document bytes live separately from database metadata.','data'),
 ('C20','backend/app/models/resume_intake.py','Intake repository and leases','Maintains batches/items, revisions, summary counts and fenced processing leases.','data'),
 ('C21','backend/app/models/jobs.py','Background job journal','Deduplicates intents, atomically claims pending work, reclaims expired leases and records retries, backoff and dead-letter outcomes.','data'),
 ('C22','backend/app/services/resume_intake_jobs.py','Import, parse and maintenance','Imports batches into per-file items; parses safely; checks duplicates; publishes review-ready data; reconciles enqueue gaps and runs retention maintenance.','workers'),
 ('C23','backend/app/services/resume_kafka.py','Kafka relay and consumer','Relays only opaque job IDs; consumes one at a time, claims the exact DB job, and commits offsets after handling or durable retry.','workers'),
 ('C24','backend/app/services/worker.py','Job dispatcher','Runs a handler for the claimed kind; catches unexpected failures; the free profile shares one intake slot across import/parse/scoring/confirmation.','workers'),
 ('C25','backend/app/services/resume_intake_security.py','Document validation and ClamAV','Checks supported file content, ZIP safety and stream scanning; scanner failure never counts as a clean scan.','security'),
 ('C26','backend/app/services/resume_intake_parse.py','Isolated parser adapter','Runs a child process with document bytes and an allowlisted environment; kills it after a 60-second parsing timeout.','workers'),
 ('C27','backend/app/services/_resume_intake_worker.py','PDF, DOCX, DOC extraction','Extracts locally, uses OCR when configured, rejects invalid/encrypted/oversized PDFs, enriches a validated candidate profile.','workers'),
 ('C28','backend/app/services/_resume_intake_limits.py','Parser resource limits','Applies the existing 768 MiB process/job boundary before accepting document bytes; limits do not equal an OS-level network sandbox.','security'),
 ('C29','backend/app/services/resume_intake_selection.py','Human-selected ATS eligibility','Requires a saved score range and fresh profile/job/text fingerprint before a resume can be confirmed as a candidate.','services'),
 ('C30','backend/app/services/resume_intake_ats.py','Local advisory ATS score','Computes skills/experience/education/keywords/role dimensions, excludes unavailable dimensions and never transitions the hiring stage.','services'),
 ('C31','backend/app/services/resume_intake_llm.py','Optional OpenRouter scoring','Computes local score first; redacts provider context; keeps it on AI failure/rate limits; successful AI may supply overall score with review flags.','integrations'),
 ('C32','backend/app/services/resume_intake_review.py','Candidate creation saga','Journals human confirmation before side effects, derives stable IDs, creates candidate/application and resumes partial failures.','services'),
 ('C33','backend/app/services/resume_intake_bulk.py','Bulk profile confirmation','Processes an approved range with revision and eligibility checks; preserves per-item outcomes and requires authorized review.','services'),
 ('C34','backend/app/services/resume_intake_retention.py','Retention and deletion','Sweeps expired/deleted intake files and anonymizes expired candidate data while preserving workflow linkage where required.','workers'),
 ('C35','backend/app/services/transitions.py','Application state machine','Validates stage moves, updates application status and positionsFilled, then records history/audit. Those writes are not one global transaction.','services'),
 ('C36','frontend/src/components/assessments/AssessmentLibrary.tsx','Assessment library UI','Shows saved assessment configurations and routes to draft, CSV, preview, publication and assignments.','ui'),
 ('C37','backend/app/api/assessment_management.py','Assessment management routes','Authorizes native V2 draft/CSV/publish actions and delegates to the service.','api'),
 ('C38','backend/app/services/assessment_management.py','Draft and publication service','Saves configuration locally; explicit publication sends provider /assessment; ambiguous outcomes become uncertain and block blind retries.','services'),
 ('C39','backend/app/models/assessment_management.py','Assessment persistence','Stores configuration, hashes, revisions and publication state in assessments. Assessment jobId is a provider/config ID, not the hiring jobId.','data'),
 ('C40','backend/app/services/assessment_csv.py','CSV assessment import','Validates grouped question data before creating drafts; bad groups do not erase successful groups.','services'),
 ('C41','backend/app/api/assessments.py','Application assessment send/sync API','Accepts selected application IDs, checks access, writes send intent and optionally processes durable jobs immediately for generate-only actions.','api'),
 ('C42','backend/app/services/assessment_flow.py','Hiring-linked assessment workflow','Links jobs to provider assessments, writes per-application intent, generates candidate interviews, queues email, and polls submission/report state.','services'),
 ('C43','backend/app/services/primehire_api.py','PrimeHire assessment adapter','Keeps provider credentials server-side and parses actual interview/status/report responses; no fabricated provider IDs.','integrations'),
 ('C44','backend/app/services/email_send.py','ZeptoMail delivery','Queues encrypted outbox messages, honors dry-run/recipient gates, calls provider with bounded retries and wipes successful sent bodies.','integrations'),
 ('C45','backend/app/models/outbox.py','Email outbox repository','Stores delivery intent and send status independently of candidate stage; external delivery is not exactly-once.','data'),
 ('C46','backend/app/api/candidate_management.py','Candidate Management API','Reads candidate/application history and creates explicit assessment assignments and generated links.','api'),
 ('C47','backend/app/services/candidate_management.py','Candidate assignment workflow','Stores separate candidate_assignments, generates encrypted links synchronously and marks ambiguous provider responses Uncertain; does not automatically populate applications.assessment.','services'),
 ('C48','backend/app/services/reporting.py','Versioned report service','Verifies source/application context, persists versioned evidence and summaries, and pins source snapshots to interview bookings.','services'),
 ('C49','backend/app/api/reporting.py','Reports API','Provides authorized report views, version history, refresh and export actions.','api'),
 ('C50','backend/app/api/recruitment.py','Recruitment workspace API','Exposes scheduling, review, managerial drafts/summary retry, compensation, offers, HR questions and contact controls.','api'),
 ('C51','backend/app/services/recruitment.py','Human interview lifecycle','Checks eligibility/overlap/assignment, saves booking, journals locked reviews, applies stage transitions and recovers pending transitions.','services'),
 ('C52','backend/app/models/recruitment.py','Recruitment records and leases','Provides org-scoped interview updates, optimistic revisions, shared processing leases and notifications.','data'),
 ('C53','backend/app/security/recruitment.py','Interviewer confidentiality','Restricts interview access and review submission to matching assignment; projects fields based on authorized visibility.','security'),
 ('C54','frontend/src/components/recruitment/InterviewDialog.tsx','Interviewer workspace','Shows candidate/job/evidence and review; managerial notes and drafts are distinct from locked submitted feedback; HR questions/offer controls are conditional.','ui'),
 ('C55','backend/app/services/managerial_feedback.py','Managerial AI summary','Reads submitted evaluation, permitted prior evidence and notes; creates separate summary state without changing the human recommendation.','integrations'),
 ('C56','backend/app/services/recruitment_questions.py','HR question suggestions','Combines permitted profile/job/previous feedback, stores questions and supports bounded generation or local guidance.','integrations'),
 ('C57','backend/app/services/recruitment_worker.py','Recruitment reconciliation and mail','Replays unapplied reviews/transitions, schedules notifications/reminders and runs optional calendar and talent maintenance.','workers'),
 ('C58','backend/app/services/google_calendar.py','Optional Google Calendar outbox','When configured and authorized, checks availability and queues revision-aware events; lack of a connection permits the manual path.','integrations'),
 ('C59','backend/app/services/google_oauth.py','Google connection authorization','Separates Google sign-in from calendar scopes and protects connection tokens; it is not implied by an email address.','security'),
 ('C60','backend/app/services/talent.py','Talent pool reuse','Creates advisory matches with consent/access/retention checks; recruiter reuse creates job context without automatically sending outreach.','services'),
 ('C61','backend/app/services/capacity_guard.py','Local capacity backpressure','In the opt-in free profile, warns below 40% available memory/disk and pauses new intake below the 30% reserve; samples CPU and persists health.','workers'),
 ('C62','backend/app/api/diagnostics.py','Operational diagnostics','Shows worker/outbox/dead-job status; deployment capacity endpoints and metrics are restricted to Super Admin.','api'),
 ('C63','frontend/src/components/FreeTierAlert.tsx','Super Admin capacity banner','Polls local capacity every 30 seconds and warns on paused/warning/stale monitoring.','ui'),
 ('C64','backend/deploy/runtime.py','Deployment process roles','Starts API, resume, assessment, scheduler or recruitment role separately; validates private DB, scanner and Kafka when configured.','infra'),
 ('C65','backend/deploy/oracle/elitehr.slice','Fixed host resource slice','Sets aggregate CPUQuota=70%, MemoryHigh=4000M and MemoryMax=4500M; these are local execution controls, not OCI billing telemetry.','infra'),
 ('C66','backend/deploy/oracle/elitehr-kafka.service','Private Kafka service','Runs a single broker/controller container with local storage, bounded memory and loopback listeners.','infra'),
 ('C67','backend/deploy/oracle/kafka.env.example','Kafka topology and retention','One partition and replication factor one; 24-hour/size retention means DB intent and source files remain the recovery authority.','infra'),
 ('C68','backend/deploy/oracle/limit_egress.sh','Outbound rate limit','Caps the dedicated VM default interface at 20 Mbit/s; it does not cover other OCI resources or the frontend service.','infra'),
 ('C69','backend/deploy/oracle/backup.py','Encrypted backup procedure','Creates a private backup during a controlled writer-maintenance window; actual recovery requires tested restore and preserved keys.','infra'),
 ('C70','backend/app/api/auth.py','Login, refresh, MFA and logout','Checks credentials/MFA, issues access/session context and rotates refresh cookies; includes invitations/password management.','security'),
 ('C71','backend/app/api/users.py','Staff and role administration','Manages staff lifecycle and invitations with role/organization restrictions; user management is separate from candidate creation.','api'),
 ('C72','backend/app/config.py','Configuration switches','Code defaults and environment validation select database backend, optional integrations, worker counts and the free profile; secrets are not graph data.','infra'),
 ('C73','backend/tests/test_kafka_live.py','Real-broker synthetic smoke test','Tests 1000 opaque job messages with a fake parser and in-memory DB. This is not a real-resume performance benchmark.','tests'),
 ('C74','backend/tests/test_free_tier_kafka.py','Queue and capacity regression tests','Exercises replay, duplicate handling, provider failure and resource backpressure with synthetic records.','tests'),
 ('C75','frontend/src/lib/resumeBulkUpload.test.ts','Bulk upload client tests','Checks sequential thousand-file chunking, idempotent retry keys and abort behavior using mock requests.','tests'),
]

FUNCTIONS = [
 ('F01','C08','create_job','POST /api/jobs validates and persists job context before returning 201.'),
 ('F02','C18','accept_upload','Stores batch/reservation/import intent; 202 means accepted.'),
 ('F03','C22','import_batch','Expands a batch into individual items and parse jobs.'),
 ('F04','C23','relay_once','Publishes at most 100 due job IDs and marks delivery only after broker acknowledgement.'),
 ('F05','C23','consume','Consumes one message, invokes exact DB claim and manually commits the offset.'),
 ('F06','C21','claim_next','Atomic pending/deferred/expired-running claim with lease and attempt increment.'),
 ('F07','C22','parse_item','Validates, scans, extracts and writes review-ready fields; expected file errors are stored as item outcomes.'),
 ('F08','C26','isolated','Child-process parser with a 60-second communicate deadline.'),
 ('F09','C29','require_selection','Blocks candidate creation when the score is stale or outside the human band.'),
 ('F10','C32','confirm','Persists confirmation journal and stable candidate/application IDs before replayable writes.'),
 ('F11','C35','transition_application','Enforces allowed stage changes and records the workflow history.'),
 ('F12','C38','publish','Draft -> publishing -> published, or draft/uncertain on failure.'),
 ('F13','C42','request_assessment_send','Persists send_requested and queues assessment_send.'),
 ('F14','C42','handle_assessment_sync','Polls provider evidence and advances an eligible application after actual submission.'),
 ('F15','C47','generate_link','Separate Candidate Management link generation with Generated/Failed/Uncertain states.'),
 ('F16','C51','schedule','Validates booking eligibility and overlaps under application/user/candidate leases.'),
 ('F17','C51','submit_review','Persists immutable review before stage effects, then triggers managerial summary when relevant.'),
 ('F18','C51','finalize_review','Replays unapplied review effects without inserting a new review.'),
 ('F19','C55','generate_summary','Persists AI summary status independently of locked review data.'),
 ('F20','C61','capacity_snapshot','Host resource signal with a 30% reserve; unavailable monitoring fails closed for intake.'),
]

FLOWS = [
 ('access','Identity and authorization', ['C03','C06','C07','C70','C71'], [
  ('Login and invite','User accepts an invite or logs in; MFA applies when configured. Passwords and session secrets stay server-side.'),
  ('Authorize every request','Browser supplies bearer/cookie context. API verifies organization, role, session and resource ownership; UI hiding is not authorization.')]),
 ('jobs','Job creation and ownership', ['C01','C02','C08','C09'], [
  ('Prepare and submit','HR/admin reviews job fields and JD, then sends JSON through authenticated HTTP.'),
  ('Validate and persist','Backend checks dates, ownership, active assignee and duplicate keys, stores jobs and audit, then returns saved job ID.')]),
 ('intake','500-resume upload', ['C13','C14','C15','C16','C17','C18'], [
  ('Select 500 files','Choose a writable open job and confirm consent. Ten-file chunks normally mean fifty sequential upload requests.'),
  ('Admit and save each chunk','Body/auth/resource gates run; originals stream to private files, hashes and batch reservations become durable.'),
  ('Return acceptance','202 returns a batch ID; accepted chunks are preserved even if later chunks fail.')]),
 ('parsing','Local scan and extraction through Kafka', ['C19','C20','C21','C22','C23','C24','C25','C26','C27'], [
  ('Import stored originals','Import worker creates per-file intake items, quarantined file records and durable parse jobs.'),
  ('Relay IDs to Kafka','DB due-job relay sends only jobId, never a PDF or candidate profile.'),
  ('Consume and claim','One consumer claims the exact job and invokes the existing parser handler under a lease.'),
  ('Scan and extract','ClamAV must return clean. Bounded subprocess extracts PDF/DOCX/DOC text and optional OCR.'),
  ('Persist then commit','Store review data or explicit item error, finish durable job state, then commit Kafka offset. Duplicate delivery is tolerated.')]),
 ('selection','ATS review and candidate confirmation', ['C29','C30','C31','C32','C33'], [
  ('Save ATS band','Human chooses eligibility range; fresh job/profile/text fingerprints govern scoring validity.'),
  ('Compute advisory score','Local dimensions always exist first. Optional OpenRouter may supply overall score; failure retains local evidence.'),
  ('Confirm profiles','Approved eligible resumes create/reuse applicants and applications through a replayable confirmation journal; application starts PARSED.')]),
 ('assessment','Assessment definition and application delivery', ['C35','C36','C37','C38','C39','C40','C41','C42','C43','C44'], [
  ('Publish questions','Save draft/CSV locally; human publication calls provider /assessment. Uncertain response blocks blind repeat.'),
  ('Link and shortlist','Hiring job links assessmentJobId. Human moves eligible PARSED applications to SHORTLISTED.'),
  ('Generate assessment interview','Write application send intent, call provider /interview, save real link/IDs and protected access code.'),
  ('Deliver invitation','Queue encrypted email intent and delivery job; only a real successful send catches the stage up to ASSESSMENT_SENT.'),
  ('Synchronize result','Poll provider for actual submission/report; preserve report-pending separately and advance the application when evidence supports it.')]),
 ('assignments','Separate Candidate Management assignment path', ['C46','C47'], [
  ('Assign assessment window','Store candidate_assignments linking candidate, optional application and assessment; verify access/window/revision.'),
  ('Generate protected link','Synchronous provider call; persist Generated or Failed/Uncertain. This path does not automatically execute the application send/sync workflow.')]),
 ('reports','Read-only report evidence', ['C48','C49'], [
  ('Capture report versions','Verify source identities and save report_catalog/report_versions/report_summaries.'),
  ('Pin interview snapshot','Booking retains a particular source report/version; later report regeneration does not silently rewrite it.')]),
 ('technical','Developer / technical round', ['C50','C51','C52','C53','C54','C57','C58'], [
  ('Schedule technical interviewer','Eligible application, matching active role, future window and candidate/interviewer conflicts are validated.'),
  ('Conduct and review','Assigned interviewer reads permitted evidence and submits locked scorecard/reasons after the scheduled start.'),
  ('Advance or branch','Positive recommendation leads to ROUND2_PENDING_ASSIGNMENT; hold/reject/another_round are explicit alternatives.')]),
 ('managerial','Managerial round and AI feedback', ['C51','C54','C55'], [
  ('Book managerial round','Recruiter assigns an active managerial interviewer to the correct application.'),
  ('Save notes and draft','Draft is incomplete/editable and remains distinct from a submitted review; server records author/time/revision.'),
  ('Submit and summarize','Human review becomes locked; positive decision reaches HR_ROUND. AI summary succeeds or fails separately and can be retried.')]),
 ('hr','Final HR and hiring outcome', ['C50','C51','C54','C56'], [
  ('Prepare HR interview','HR reads permitted earlier summaries and optional generated behavioral questions.'),
  ('Record decision and compensation','Positive HR review permits offer workflow; proposed/agreed compensation is required for offered/accepted/joined.'),
  ('Record joining','Offer accepted is not hired. Explicit joined checks available positions and transitions to HIRED; declined follows rejection.')]),
 ('talent','Talent reuse and lifecycle', ['C34','C35','C60'], [
  ('Hold or rejection handling','Human-authorized transitions preserve reasons/history; eligibility and consent control talent-pool reuse.'),
  ('Retention and closure','Workers maintain expiry/anonymization and job lifecycle; database/file backups need a restore procedure.')]),
 ('operations','Fixed deployment and failure recovery', ['C61','C62','C63','C64','C65','C66','C67','C68','C69','C72'], [
  ('Separate process roles','Cloudflare serves UI/gateway; Oracle hosts API, configured DB, storage, scanner, Kafka and worker roles.'),
  ('Apply backpressure','Fixed profile avoids autoscaling; admission/CPU/memory/outbound controls protect the planned envelope.'),
  ('Observe and recover','Super Admin sees local metrics and dead jobs. Leases/replay preserve intent; permanent failures require explicit operator review.')]),
]


def read(path):
    return path.read_text(encoding='utf-8-sig')


def main():
    OUT.mkdir(exist_ok=True)
    commit = subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()
    project = {'name':'PrimeHire technical KT','languages':['TypeScript','Python','JavaScript','SQL','Shell'],
        'frameworks':['React','FastAPI','Kafka','MongoDB','PostgreSQL JSONB','Cloudflare Pages','systemd'],
        'description':'Curated end-to-end workflow map of current working-tree source; not exhaustive per-symbol analysis or evidence of a live deployment.',
        'analyzedAt':'2026-11-10','gitCommitHash':commit}
    nodes=[]; edges=[]; by_id={}; files={}; hashes={}
    for key, path, name, summary, layer in SOURCES:
        file=ROOT/path
        assert file.is_file(), path
        content=read(file)
        hashes[path]=hashlib.sha256(file.read_bytes()).hexdigest()
        node={'id':key,'type':'file','name':name,'filePath':path,'lineRange':[1,len(content.splitlines())],
            'summary':summary,'tags':[layer,'kt-evidence'],'complexity':'complex' if layer in {'workers','services','data'} else 'moderate'}
        nodes.append(node);by_id[key]=node;files[key]=content
    for key, parent, symbol, summary in FUNCTIONS:
        tree=ast.parse(files[parent])
        found=[item for item in ast.walk(tree) if isinstance(item,(ast.FunctionDef,ast.AsyncFunctionDef)) and item.name==symbol]
        assert found, (parent,symbol)
        item=found[0]
        node={'id':key,'type':'function','name':symbol,'filePath':by_id[parent]['filePath'],
            'lineRange':[item.lineno,item.end_lineno],'summary':summary,'tags':by_id[parent]['tags'],'complexity':'complex'}
        nodes.append(node);by_id[key]=node
        edges.append(edge(parent,key,'contains','Source implementation'))
    relations=[
     ('C01','C02','calls'),('C02','C03','calls'),('C15','C03','calls'),('C03','C04','routes'),('C04','C05','routes'),('C05','C06','middleware'),('C06','C07','depends_on'),
     ('C08','C09','writes_to'),('C09','C10','depends_on'),('C10','C11','depends_on'),('C11','C12','calls'),
     ('C13','C14','calls'),('C14','C15','calls'),('C16','C17','middleware'),('C17','C18','calls'),('C18','C19','writes_to'),('C18','C20','writes_to'),('C18','C21','writes_to'),
     ('C21','C22','triggers'),('C22','C20','writes_to'),('C22','C21','writes_to'),('C21','C23','triggers'),('C23','C24','calls'),('C24','C22','calls'),('C22','C25','validates'),('C22','C26','calls'),('C26','C27','calls'),('C27','C28','depends_on'),
     ('C22','C29','triggers'),('C29','C31','calls'),('C31','C30','calls'),('C29','C32','validates'),('C33','C32','calls'),('C32','C09','writes_to'),('C35','C09','writes_to'),
     ('C36','C37','calls'),('C37','C38','calls'),('C38','C39','writes_to'),('C38','C40','calls'),('C41','C42','calls'),('C42','C43','calls'),('C42','C44','triggers'),('C44','C45','writes_to'),('C42','C48','calls'),('C42','C35','calls'),
     ('C46','C47','calls'),('C47','C43','related'),('C49','C48','calls'),('C50','C51','calls'),('C51','C52','writes_to'),('C51','C53','validates'),('C54','C50','calls'),('C51','C48','reads_from'),('C51','C35','calls'),('C51','C55','triggers'),('C50','C56','calls'),('C57','C51','calls'),('C57','C58','calls'),('C58','C59','depends_on'),('C57','C60','calls'),
     ('C61','C18','configures'),('C61','C23','configures'),('C62','C61','reads_from'),('C63','C62','calls'),('C64','C24','triggers'),('C64','C23','triggers'),('C64','C57','triggers'),('C65','C64','configures'),('C66','C23','serves'),('C67','C66','configures'),('C68','C64','configures'),('C69','C19','reads_from'),('C70','C06','related'),('C71','C70','related'),('C72','C64','configures'),('C23','C73','tested_by'),('C23','C74','tested_by'),('C14','C75','tested_by'),
    ]
    edges += [edge(*row) for row in relations]
    layers=[{'id':layer,'name':layer.title(),'description':f'{layer.title()} components in the reviewed workflow.',
        'nodeIds':[n['id'] for n in nodes if layer in n['tags']]} for layer in dict.fromkeys(row[4] for row in SOURCES)]
    tour=[{'order':i+1,'title':title,'description':' '.join(text for _,text in steps), 'nodeIds':refs}
        for i,(_,title,refs,steps) in enumerate(FLOWS)]
    graph={'version':'1.0.0','kind':'codebase','project':project,'nodes':nodes,'edges':edges,'layers':layers,'tour':tour}
    domain_nodes=[];domain_edges=[]
    for index,(key,title,refs,steps) in enumerate(FLOWS):
        domain=f'domain:{key}';flow=f'flow:{key}'
        domain_nodes += [dict(id=domain,type='domain',name=title,summary=' '.join(text for _,text in steps),tags=['business'],complexity='moderate'),
            dict(id=flow,type='flow',name=title,summary=f'Flow {index+1}: source-backed sequence.',tags=['business'],complexity='moderate',domainMeta={'entryType':'manual','businessRules':[text for _,text in steps]})]
        domain_edges.append(edge(domain,flow,'contains_flow'))
        previous=flow
        for number,(name,text) in enumerate(steps,1):
            step=f'step:{key}:{number}'
            domain_nodes.append(dict(id=step,type='step',name=name,summary=text+' Evidence: '+', '.join(refs),tags=['business'],complexity='simple'))
            domain_edges.append(edge(flow,step,'flow_step'))
            if previous!=flow:domain_edges.append(edge(previous,step,'triggers'))
            previous=step
        if index:
            # Relationship only: the assignment branch is not automatic progression.
            domain_edges.append(edge(f'domain:{FLOWS[index-1][0]}',domain,'cross_domain','Related domain; follow documented eligibility/branch rules.'))
    domain_graph={**graph,'nodes':domain_nodes,'edges':domain_edges,'layers':[],
        'tour':[dict(order=i+1,title=title,description=' '.join(t for _,t in steps),nodeIds=[f'domain:{key}',f'flow:{key}']) for i,(key,title,_,steps) in enumerate(FLOWS)]}
    for name,data in [('knowledge-graph.json',graph),('domain-graph.json',domain_graph)]:
        validate(data)
        (OUT/name).write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    (OUT/'config.json').write_text(json.dumps({'autoUpdate':False,'outputLanguage':'en'},indent=2)+'\n',encoding='utf-8')
    (OUT/'meta.json').write_text(json.dumps({'lastAnalyzedAt':'2026-11-10','gitCommitHash':commit,'version':'1.0.0','analyzedFiles':len(SOURCES)},indent=2)+'\n',encoding='utf-8')
    manifest={'analysisDate':'2026-11-10','scope':'Curated KT workflows, not an exhaustive whole-repository symbol graph',
        'baseCommit':commit,'sourceHashes':hashes,'upstream':{'repository':'https://github.com/Egonex-AI/Understand-Anything','viewerVersion':'2.9.0','inspectedCommit':'182c7fbf1745d9acd55dda6c47cceff77de4c111'}}
    (OUT/'kt-source-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf-8')
    refs=['# KT source evidence','', 'Generated from the current working tree; source hashes are in `.ua/kt-source-manifest.json`.','', '| ID | Source | Meaning |','|---|---|---|']
    for key,path,name,summary,_ in SOURCES:
        refs.append(f'| {key} | [{path}](<{(ROOT/path).as_posix()}:1>) | {summary} |')
    refs += ['', '| Function ID | Exact source | Role |','|---|---|---|']
    for key,_,symbol,summary in FUNCTIONS:
        n=by_id[key]
        refs.append(f'| {key} | [{symbol}](<{(ROOT/n["filePath"]).as_posix()}:{n["lineRange"][0]}>) | {summary} |')
    (ROOT/'docs/technical-kt/SOURCE_EVIDENCE.md').write_text('\n'.join(refs)+'\n',encoding='utf-8')
    print(f'Validated {len(nodes)} structural nodes, {len(edges)} edges, {len(tour)} guided chapters; {len(domain_nodes)} business nodes; {len(hashes)} source files.')


def edge(source,target,kind,description='Source-traced relationship'):
    return dict(source=source,target=target,type=kind,direction='forward',description=description,weight=1)


def validate(graph):
    ids=[n['id'] for n in graph['nodes']]
    assert len(ids)==len(set(ids)), 'Duplicate graph IDs'
    for e in graph['edges']:
        assert e['source'] in ids and e['target'] in ids, e
    for layer in graph['layers']:
        assert set(layer['nodeIds'])<=set(ids)
    for step in graph['tour']:
        assert set(step['nodeIds'])<=set(ids)
    for n in graph['nodes']:
        if 'filePath' in n:
            path=ROOT/n['filePath']
            assert path.is_file() and path.resolve().is_relative_to(ROOT)
            start,end=n['lineRange']
            assert 1<=start<=end<=len(read(path).splitlines()),n


if __name__=='__main__':
    main()
