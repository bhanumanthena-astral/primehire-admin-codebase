import {useEffect, useMemo, useState} from 'react';
import {Link} from 'react-router-dom';
import {Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis} from 'recharts';
import {Settings2, Sparkles, ArrowRight, ArrowUpRight, BriefcaseBusiness, CheckCheck, ChevronDown, ChevronRight, Clock3, Files, GitBranch, LayoutDashboard, LogOut, RefreshCw, Search, UserRound, UsersRound} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Table, TableBody, TableCell, TableHead, TableHeader, TableRow} from '@/components/ui/table';
import {AppSelect} from '../components/ui/AppSelect';
import {ModeToggle} from '../components/ui/primitives';
import {useAuth} from '../lib/authContext';
import {LeadershipData, LeadershipRole, LeadershipTiming, loadLeadership} from '../lib/leadershipApi';
import './leadership.css';
import {LeadershipAssistant} from '../components/LeadershipAssistant';

const formatNumber = new Intl.NumberFormat('en-IN');
const formatDay = new Intl.DateTimeFormat('en-IN', {day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata'});
const formatUpdated = new Intl.DateTimeFormat('en-IN', {day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata'});
const stageColors = ['#82aaee', '#4d78de', '#244eaf', '#24386b', '#14a295', '#d39136', '#24704e', '#8391a5', '#af6278', '#75739a'];
const navigation = [
  {key: 'overview', label: 'Hiring overview', icon: LayoutDashboard},
  {key: 'roles', label: 'Role portfolio', icon: BriefcaseBusiness},
  {key: 'timing', label: 'Handoff times', icon: Clock3},
] as const;
type View = (typeof navigation)[number]['key'];

export function duration(hours: number | null) {
  if (hours === null) return 'Unavailable';
  if (hours < 1) return Math.round(hours * 60) + 'm';
  if (hours < 48) return Number(hours.toFixed(1)) + 'h';
  return Number((hours / 24).toFixed(1)) + 'd';
}

function shortDate(value: string) {
  return formatDay.format(new Date(value.slice(0, 10) + 'T12:00:00+05:30'));
}

function PortfolioStats({data}: {data: LeadershipData}) {
  const m = data.summary;
  const entries = [
    {label: 'Hires', value: m.hired, context: 'Joined candidates · all time', icon: UsersRound},
    {label: 'Open roles', value: m.openRoles, context: formatNumber.format(m.openPositions) + ' positions to fill', icon: BriefcaseBusiness},
    {label: 'Resumes received', value: m.resumesInWindow, context: 'Last ' + data.days + ' days', icon: Files},
    {label: 'Assessments completed', value: m.assessmentsCompleted, context: formatNumber.format(m.linksSent) + ' links sent · all time', icon: CheckCheck},
    {label: 'In interview rounds', value: m.technical + m.managerial + m.hr, context: m.technical + ' technical · ' + m.managerial + ' managerial · ' + m.hr + ' HR', icon: UsersRound},
  ];
  return <section className="ld-stats" aria-label="Hiring metrics">
    {entries.map(({label, value, context, icon: Icon}) => <article key={label}>
      <div className="ld-stat-label"><Icon size={17}/><h2>{label}</h2></div>
      <strong>{formatNumber.format(value)}</strong>
      <p>{context}</p>
    </article>)}
  </section>;
}

function ActivityChart({data}: {data: LeadershipData}) {
  return <section className="ld-panel ld-activity">
    <div className="ld-panel-head">
      <div><h2>Hiring activity</h2><p>{formatDay.format(new Date(data.windowStart))} – {shortDate(data.trend.at(-1)?.date || data.windowStart)} · daily totals</p></div>
      <span className="ld-legend"><i/>Resumes <b/>Assessments completed</span>
    </div>
    <div className="ld-chart" role="group" aria-label="Daily resume intake and assessment completions">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data.trend} margin={{left: -20, right: 12, top: 16, bottom: 1}} accessibilityLayer>
          <CartesianGrid vertical={false} stroke="var(--ld-line)" strokeDasharray="3 4"/>
          <XAxis dataKey="date" tickFormatter={shortDate} minTickGap={26} tickMargin={9} tickLine={false} axisLine={false} tick={{fontSize: 10, fill: 'var(--ld-muted)'}}/>
          <YAxis allowDecimals={false} tickMargin={4} axisLine={false} tickLine={false} tick={{fontSize: 10, fill: 'var(--ld-muted)'}}/>
          <Tooltip labelFormatter={value => shortDate(String(value))} cursor={{fill: 'var(--ld-hover)'}} contentStyle={{background: 'var(--ld-paper)', borderColor: 'var(--ld-line)', borderRadius: 8, color: 'var(--ld-text)'}}/>
          <Line type="monotone" dataKey="resumes" name="Resumes" stroke="var(--ld-bar)" strokeWidth={2.5} dot={false} isAnimationActive={false}/>
          <Line dataKey="assessments" name="Assessments completed" stroke="var(--ld-teal)" strokeWidth={2.4} dot={data.days <= 7} isAnimationActive={false}/>
        </ComposedChart>
      </ResponsiveContainer>
    </div>
    <details className="ld-daily"><summary>Daily figures</summary>
      <div><Table><TableHeader><TableRow><TableHead>Date (IST)</TableHead><TableHead>Resumes</TableHead><TableHead>Assessments completed</TableHead></TableRow></TableHeader>
        <TableBody>{data.trend.map(day => <TableRow key={day.date}><TableCell>{shortDate(day.date)}</TableCell><TableCell>{day.resumes}</TableCell><TableCell>{day.assessments}</TableCell></TableRow>)}</TableBody>
      </Table></div>
    </details>
  </section>;
}

const handoffNames: Record<string, string> = {
  assessmentResponse: 'Assessment starts', technicalScheduling: 'Technical bookings',
  managerialScheduling: 'Managerial bookings', hrScheduling: 'HR bookings',
};

function WaitingPanel({timing, onSelect}: {timing: LeadershipTiming[]; onSelect: (key: string) => void}) {
  const overdue = timing.reduce((sum, row) => sum + row.overdue, 0);
  return <section className="ld-waiting">
    <div className="ld-waiting-title"><Clock3 size={18}/><h2>Handoffs awaiting action</h2></div>
    <div className="ld-waiting-total"><strong>{formatNumber.format(overdue)}</strong><p>waiting 48 hours or more</p></div>
    <div className="ld-waiting-rows">{timing.map(row => <button key={row.key} onClick={() => onSelect(row.key)} aria-label={row.label + ', ' + row.overdue + ' waiting 48 hours or more'}>
      <span>{handoffNames[row.key] || row.label}</span><b>{row.overdue}</b><ArrowUpRight size={14}/>
    </button>)}</div>
  </section>;
}

function Pipeline({data, onRole}: {data: LeadershipData; onRole: (id: string) => void}) {
  const [selected, setSelected] = useState('');
  const stages = data.stages.filter(row => row.count > 0);
  const total = stages.reduce((sum, row) => sum + row.count, 0);
  let offset = 0;
  const slices = stages.map(row => {
    const start = offset;
    offset += row.count / total * 100;
    const color = stageColors[data.stages.indexOf(row) % stageColors.length];
    return {row, color, gradient: color + ' ' + start + '% ' + offset + '%'};
  });
  const current = stages.find(row => row.key === selected);
  const roleRows = current ? data.roles.filter(role => role.stages[current.key] > 0).sort((a, b) => b.stages[current.key] - a.stages[current.key]) : [];
  return <section className="ld-panel">
    <div className="ld-panel-head"><div><h2>Current pipeline</h2><p>Applications by current stage</p></div><GitBranch size={18}/></div>
    <div className="ld-pipeline">
      <div className="ld-ring" aria-hidden="true" style={total ? {background: 'conic-gradient(' + slices.map(slice => slice.gradient).join(',') + ')'} : undefined}>
        <div><strong>{formatNumber.format(current?.count ?? total)}</strong><span>{current?.label || 'Applications'}</span></div>
      </div>
      <div className="ld-stage-list" aria-label="Current stage counts">
        {slices.map(({row, color}) => <button key={row.key} onClick={() => setSelected(selected === row.key ? '' : row.key)} aria-pressed={selected === row.key} aria-label={row.label + ': ' + row.count + ' applications'}>
          <i style={{background: color}}/><span>{row.label}</span><b>{row.count}</b>
        </button>)}
        {!total && <p>No applications yet.</p>}
      </div>
    </div>
    {current && <div className="ld-stage-detail"><h3>{current.label} by role</h3>
      {roleRows.map(role => <button key={role.jobId} onClick={() => onRole(role.jobId)} aria-label={'View ' + role.title + ': ' + role.stages[current.key] + ' at this stage'}>
        {role.title} <b>{role.stages[current.key]}</b><ArrowUpRight size={13}/>
      </button>)}
    </div>}
  </section>;
}

type SortKey = 'title' | 'resumesUploaded' | 'hrOverdue';
function RoleTable({roles, onRole, preview, onExpand}: {roles: LeadershipRole[]; onRole: (id: string) => void; preview?: boolean; onExpand?: () => void}) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('resumesUploaded');
  const [ascending, setAscending] = useState(false);
  const [page, setPage] = useState(0);
  const results = useMemo(() => roles.filter(row => (row.title + ' ' + row.department).toLowerCase().includes(query.toLowerCase())).sort((a, b) => {
    const order = sort === 'title' ? a.title.localeCompare(b.title) : a[sort] - b[sort];
    return ascending ? order : -order;
  }), [roles, query, sort, ascending]);
  const limit = preview ? 5 : 10;
  const lastPage = Math.max(0, Math.ceil(results.length / limit) - 1);
  const activePage = Math.min(page, lastPage);
  function sortColumn(key: SortKey) {
    setAscending(sort === key ? !ascending : key === 'title');
    setSort(key);
    setPage(0);
  }
  const sortable = (key: SortKey, label: string) => <TableHead aria-sort={key === sort ? (ascending ? 'ascending' : 'descending') : 'none'}>
    <button onClick={() => sortColumn(key)}>{label} {key === sort ? (ascending ? '↑' : '↓') : '↕'}</button>
  </TableHead>;
  return <section className="ld-panel ld-role-panel">
    <div className="ld-panel-head"><div><h2>{preview ? 'Roles at a glance' : 'Role comparison'}</h2><p>{preview ? 'Resumes and completions per role · all time' : 'All-time activity and current interview round counts'}</p></div>
      {preview && <button className="ld-text-link" onClick={onExpand}>All roles <ArrowRight size={14}/></button>}
    </div>
    {!preview && <div className="ld-search"><Search size={15}/><Input aria-label="Find a role or department" placeholder="Find a role or department" value={query} onChange={e => {setQuery(e.target.value); setPage(0);}}/></div>}
    <Table><TableHeader><TableRow>{sortable('title', 'Role')}{!preview && <><TableHead>Status</TableHead><TableHead>Open seats</TableHead></>}
      {sortable('resumesUploaded', 'Resumes')}{!preview && <TableHead>Links sent</TableHead>}<TableHead>Completed</TableHead>
      {!preview && <><TableHead>Tech / Mgr / HR</TableHead>{sortable('hrOverdue', 'HR wait ≥48h')}</>}
    </TableRow></TableHeader><TableBody>{results.slice(activePage * limit, (activePage + 1) * limit).map(row => <TableRow key={row.jobId}>
      <TableCell><button className="ld-role-name" onClick={() => onRole(row.jobId)}>{row.title}<ArrowUpRight size={13}/></button><small>{row.department}</small></TableCell>
      {!preview && <><TableCell>{row.status.replaceAll('_', ' ')}</TableCell><TableCell>{row.status === 'OPEN' ? row.positions : 0}</TableCell></>}
      <TableCell>{formatNumber.format(row.resumesUploaded)}</TableCell>{!preview && <TableCell>{row.linksSent}</TableCell>}<TableCell>{row.assessmentsCompleted}</TableCell>
      {!preview && <><TableCell>{row.technical} / {row.managerial} / {row.hr}</TableCell><TableCell>{row.hrOverdue}</TableCell></>}
    </TableRow>)}
    {!results.length && <TableRow><TableCell colSpan={preview ? 3 : 8}>No roles match this view.</TableCell></TableRow>}
    </TableBody></Table>
    {!preview && <div className="ld-pagination"><span>{results.length} roles · Page {activePage + 1} of {lastPage + 1}</span><Button size="sm" variant="outline" disabled={!activePage} onClick={() => setPage(activePage - 1)}>Previous</Button><Button size="sm" variant="outline" disabled={activePage >= lastPage} onClick={() => setPage(activePage + 1)}>Next</Button></div>}
  </section>;
}

function TimingView({data, selected, onSelect}: {data: LeadershipData; selected: string; onSelect: (key: string) => void}) {
  const metric = data.timing.find(row => row.key === selected) || data.timing[0];
  return <>
    <section className="ld-panel">
      <div className="ld-panel-head"><div><h2>Time between hiring steps</h2><p>Elapsed time for handoffs started in the last {data.days} days. Waiting counts include older cases.</p></div></div>
      <Table><TableHeader><TableRow>{['Handoff', 'Median', '90th percentile', 'Measured / eligible', 'Waiting now', 'Waiting ≥48h'].map(label => <TableHead key={label}>{label}</TableHead>)}</TableRow></TableHeader>
        <TableBody>{data.timing.map(row => <TableRow key={row.key}>
          <TableCell><button className="ld-role-name" aria-pressed={row.key === metric?.key} onClick={() => onSelect(row.key)}>{row.label}<ChevronRight size={14}/></button></TableCell>
          <TableCell>{duration(row.medianHours)}</TableCell><TableCell>{duration(row.p90Hours)}</TableCell><TableCell>{row.samples} / {row.eligible}</TableCell><TableCell>{row.waiting}</TableCell><TableCell>{row.overdue}</TableCell>
        </TableRow>)}</TableBody>
      </Table>
      {metric && <div className="ld-distribution" aria-live="polite">
        <h3>{metric.label}</h3><p>{metric.samples ? metric.samples + ' measured handoffs' : 'No completed handoffs with valid timestamps in this period.'}</p>
        {metric.samples > 0 && <div className="ld-bars">{metric.buckets.map((count, index) => <div key={index}><span>{['Under 4h', '4–24h', '1–2d', '2–3d', '3d or more'][index]}</span>
          <meter min={0} max={Math.max(1, ...metric.buckets)} value={count}/><b>{count}</b></div>)}</div>}
      </div>}
    </section>
    <section className="ld-panel"><div className="ld-panel-head"><div><h2>Age in current stage</h2><p>Time since the most recent recorded transition</p></div></div>
      <Table><TableHeader><TableRow>{['Stage', 'Under 24h', '1–3 days', '3 days or more', 'Unknown'].map(label => <TableHead key={label}>{label}</TableHead>)}</TableRow></TableHeader>
      <TableBody>{data.aging.map(row => <TableRow key={row.key}><TableCell>{row.label}</TableCell>{(['under24', 'days1to3', 'over72', 'unknown'] as const).map(key => <TableCell key={key}><span className={'ld-age ' + (row[key] && key === 'over72' ? 'ld-age-old' : '')}>{row[key]}</span></TableCell>)}</TableRow>)}</TableBody></Table>
    </section>
  </>;
}

export function LeadershipDashboard() {
  const {user, logout} = useAuth();
  const [settingsOpen,setSettingsOpen]=useState(false);
  const [view, setView] = useState<View>('overview');
  const [days, setDays] = useState(30);
  const [jobId, setJobId] = useState('');
  const [selectedTiming, setSelectedTiming] = useState('hrScheduling');
  const [data, setData] = useState<LeadershipData | null>(null);
  const [options, setOptions] = useState<LeadershipData['jobOptions']>([]);
  const [error, setError] = useState('');
  const [version, setVersion] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    loadLeadership(days, jobId, controller.signal).then(snapshot => {
      if (!controller.signal.aborted) {
        setData(snapshot);
        setOptions(snapshot.jobOptions);
      }
    }).catch(reason => {
      if (!controller.signal.aborted) setError(reason.message);
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [days, jobId, version]);

  function navigate(next: View) {
    setView(next);
    window.scrollTo?.({top: 0});
  }
  function selectRole(id: string) {
    setJobId(id);
    navigate('overview');
  }
  const matching = data?.days === days && (data.selectedJobId || '') === jobId ? data : null;
  const title = navigation.find(item => item.key === view)!.label;
  return <div className="ld-workspace">
    <aside className="ld-sidebar">
      <div className="ld-brand"><span>EH</span><div>Elite HR<small>Leadership workspace</small></div></div>
      <nav aria-label="Leadership navigation">{navigation.map(({key, label, icon: Icon}) => <button key={key} aria-current={view === key ? 'page' : undefined} onClick={() => navigate(key)}><Icon size={18}/>{label}</button>)}<button onClick={()=>setSettingsOpen(true)}><Settings2 size={18}/>Settings</button></nav>
      <div className="ld-account"><Link to="/account/profile" aria-label="Account profile"><UserRound size={18}/><span>{user?.name || 'Account profile'}</span></Link><button aria-label="Sign out" onClick={() => void logout()}><LogOut size={16}/></button></div>
    </aside>
    <main className="ld-main">
      <div className="ld-context"><span>Leadership <ChevronRight size={13}/> {title}</span><ModeToggle/></div>
      <header className="ld-heading"><div><h1>{title}</h1><p>{matching ? 'Updated ' + formatUpdated.format(new Date(matching.generatedAt)) + ' IST' : 'Hiring analytics'}</p></div>
        <div className="ld-filters"><AppSelect aria-label="Filter by role" value={jobId} onValueChange={setJobId}><option value="">All roles</option>{options.map(role => <option value={role.jobId} key={role.jobId}>{role.title}</option>)}</AppSelect>
          <AppSelect aria-label="Activity period" value={days} onValueChange={value => setDays(Number(value))}>{[7, 30, 90, 180].map(n => <option key={n} value={n}>Last {n} days</option>)}</AppSelect>
          <Button variant="outline" aria-label="Refresh" disabled={loading} onClick={() => setVersion(n => n + 1)}><RefreshCw size={15} className={loading ? 'animate-spin' : ''}/></Button></div>
      </header>
      {error ? <section className="ld-panel ld-message" role="alert"><h2>Hiring data could not load</h2><p>{error}</p><Button onClick={() => setVersion(n => n + 1)}>Try again</Button></section>
      : !matching ? <div className="ld-panel ld-message" role="status">Loading hiring data…</div>
      : <div className="ld-content" aria-busy={loading}>
        {matching.quality.limited && <p className="ld-warning" role="status">Some records exceed the analysis limit. Charts and waiting counts show partial coverage. Select a role to narrow the analysis.</p>}
        {view === 'overview' && <>
          <PortfolioStats data={matching}/>
          <div className="ld-top-grid"><ActivityChart data={matching}/><WaitingPanel timing={matching.timing} onSelect={key => {setSelectedTiming(key); navigate('timing');}}/></div>
          <div className="ld-bottom-grid"><Pipeline data={matching} onRole={selectRole}/><RoleTable preview roles={matching.roles} onRole={selectRole} onExpand={() => navigate('roles')}/></div>
        </>}
        {view === 'roles' && <RoleTable roles={matching.roles} onRole={selectRole}/>}
        {view === 'timing' && <TimingView data={matching} selected={selectedTiming} onSelect={setSelectedTiming}/>}
        <details className="ld-definitions"><summary>Metric definitions <ChevronDown size={14}/></summary><ul>{matching.quality.notes.map(note => <li key={note}>{note}</li>)}</ul></details>
      </div>}
    </main>
    <LeadershipAssistant key={`${user?.userId}:${user?.orgId}:${days}:${jobId}`} days={days} jobId={jobId} settingsOpen={settingsOpen} onSettingsClose={()=>setSettingsOpen(false)}/>
  </div>;
}

