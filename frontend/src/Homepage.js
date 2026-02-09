import { useAuth } from './AuthContext';
import AppSidebar from './AppSidebar';
import { Link } from 'react-router-dom';
import './dashboard.css';

// Content can be moved to API or config later
const DEFAULT_RECENT = [
  { id: 1, date: '2025-01-15', title: 'Q4 release deployed to production', type: 'release' },
  { id: 2, date: '2025-01-12', title: 'AURA360 v2.0 sprint completed', type: 'milestone' },
  { id: 3, date: '2025-01-10', title: 'New QA planning workflow went live', type: 'feature' },
  { id: 4, date: '2025-01-08', title: 'Timesheet integration with Jira finalized', type: 'integration' },
  { id: 5, date: '2025-01-05', title: 'Performance review cycle opened', type: 'announcement' },
];

const DEFAULT_COMPLETED_LIVE = [
  { id: 1, name: 'Unified ticket dashboard', description: 'Single view for BIS tickets, QC status, and dev handoffs.' },
  { id: 2, name: 'QA & Dev task planning', description: 'Weekly planner, resource blocked until, and QC review fail tracking.' },
  { id: 3, name: 'Timesheet & calendar', description: 'Log hours and view allocations across the team.' },
  { id: 4, name: 'Reports & exports', description: 'Ticket reports, PDF exports, and manager access.' },
  { id: 5, name: 'Employee profiles & reviews', description: 'Profiles, performance reviews, and role-based access.' },
];

const DEFAULT_IN_DEVELOPMENT = [
  { id: 1, name: 'Advanced analytics dashboard', description: 'Trends, velocity, and release health metrics.', eta: 'Q1 2025' },
  { id: 2, name: 'Jira webhook automation', description: 'Auto-sync status and assignments from Jira.', eta: 'Q1 2025' },
  { id: 3, name: 'Mobile-friendly timesheet', description: 'Quick time entry and approval on mobile.', eta: 'Q2 2025' },
];

const DEFAULT_COMING_SOON = [
  { id: 1, name: 'Custom report builder', description: 'Build and save report templates.' },
  { id: 2, name: 'Slack/Teams notifications', description: 'Alerts for QC fail, blockers, and deadlines.' },
  { id: 3, name: 'Resource capacity forecasting', description: 'Predict capacity and suggest allocation.' },
];

function formatRecentDate(str) {
  if (!str) return '';
  const d = new Date(str);
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function Homepage() {
  const { user } = useAuth();
  const firstName = user?.name?.split(/\s+/)[0] || 'there';

  return (
    <div className="dashboard">
      <AppSidebar />
      <main className="main homepage-main">
        {/* Hero */}
        <header className="homepage-hero">
          <div className="homepage-hero-content">
            <h1 className="homepage-hero-title">
              Welcome back, <span className="homepage-hero-name">{firstName}</span>
            </h1>
            <p className="homepage-hero-subtitle">
              AURA360 — track tickets, planning, and releases in one place.
            </p>
            <div className="homepage-hero-actions">
              <Link to="/dashboard" className="homepage-cta primary">Open Ticket Dashboard</Link>
              <Link to="/tickets" className="homepage-cta secondary">View Tickets</Link>
            </div>
          </div>
          <div className="homepage-hero-accent" aria-hidden="true" />
        </header>

        {/* Recent happenings */}
        <section className="homepage-section homepage-recent">
          <h2 className="homepage-section-title">
            <span className="homepage-section-icon recent">Recent in BIS</span>
          </h2>
          <div className="homepage-timeline">
            {DEFAULT_RECENT.map((item) => (
              <div key={item.id} className="homepage-timeline-item">
                <span className="homepage-timeline-dot" />
                <div className="homepage-timeline-content">
                  <time className="homepage-timeline-date">{formatRecentDate(item.date)}</time>
                  <span className="homepage-timeline-title">{item.title}</span>
                  <span className={`homepage-timeline-type type-${item.type}`}>{item.type}</span>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Completed / Live */}
        <section className="homepage-section">
          <h2 className="homepage-section-title">
            <span className="homepage-section-icon live">Completed & live</span>
          </h2>
          <p className="homepage-section-desc">Major features that have gone live in BIS.</p>
          <div className="homepage-cards">
            {DEFAULT_COMPLETED_LIVE.map((f) => (
              <div key={f.id} className="homepage-card homepage-card-live">
                <span className="homepage-card-badge live">Live</span>
                <div className="homepage-card-icon live">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 6L9 17l-5-5" /></svg>
                </div>
                <h3 className="homepage-card-title">{f.name}</h3>
                <p className="homepage-card-desc">{f.description}</p>
              </div>
            ))}
          </div>
        </section>

        {/* In development */}
        <section className="homepage-section">
          <h2 className="homepage-section-title">
            <span className="homepage-section-icon dev">In development</span>
          </h2>
          <p className="homepage-section-desc">Upcoming major features currently in development.</p>
          <div className="homepage-cards">
            {DEFAULT_IN_DEVELOPMENT.map((f) => (
              <div key={f.id} className="homepage-card homepage-card-dev">
                <span className="homepage-card-badge dev">In progress</span>
                <div className="homepage-card-icon dev">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" /><circle cx="12" cy="12" r="3" /></svg>
                </div>
                <h3 className="homepage-card-title">{f.name}</h3>
                <p className="homepage-card-desc">{f.description}</p>
                {f.eta && <span className="homepage-card-eta">ETA: {f.eta}</span>}
              </div>
            ))}
          </div>
        </section>

        {/* Coming soon */}
        <section className="homepage-section">
          <h2 className="homepage-section-title">
            <span className="homepage-section-icon soon">Coming soon</span>
          </h2>
          <p className="homepage-section-desc">Planned major features on the roadmap.</p>
          <div className="homepage-cards">
            {DEFAULT_COMING_SOON.map((f) => (
              <div key={f.id} className="homepage-card homepage-card-soon">
                <span className="homepage-card-badge soon">Planned</span>
                <div className="homepage-card-icon soon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></svg>
                </div>
                <h3 className="homepage-card-title">{f.name}</h3>
                <p className="homepage-card-desc">{f.description}</p>
              </div>
            ))}
          </div>
        </section>

        <footer className="homepage-footer">
          <p>AURA360 · Techversant Infotech</p>
        </footer>
      </main>
    </div>
  );
}
