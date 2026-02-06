import React, { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import DevelopmentTaskPlanning from './DevelopmentTaskPlanning';
import QATaskPlanning from './QATaskPlanning';
import PlanComparison from './PlanComparison';
import { useAuth } from './AuthContext';
import AppSidebar from './AppSidebar';
import './TaskPlanning.css';

// Use planning_team from /auth/me when present; else derive from role/team (Dev tab hidden for QA, QA tab hidden for Dev).
function getEffectiveTeam(user) {
  const fromApi = (user?.planning_team || '').toUpperCase().trim();
  if (fromApi === 'QA') return 'QA';
  if (fromApi === 'DEVELOPMENT') return 'DEVELOPMENT';
  const teamNorm = (user?.team || '').toUpperCase().trim();
  const role = (user?.role || '').toUpperCase();
  const isQARole = role.includes('LEAD_QA') || role.includes('MANAGER_QA') || role === 'QA';
  const isDevRole = role.includes('LEAD_DEV') || role.includes('MANAGER_DEV') || role === 'DEVELOPMENT';
  if (isQARole && !isDevRole) return 'QA';
  if (isDevRole) return 'DEVELOPMENT';
  if (teamNorm === 'QA') return 'QA';
  if (teamNorm === 'DEVELOPMENT') return 'DEVELOPMENT';
  return 'DEVELOPMENT'; // default
}

function TaskPlanning() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const urlModule = searchParams.get('module');
  
  // Determine if user can see all modules (Admin/Manager)
  const canViewAllModules = user?.role === 'ADMIN' || user?.role?.includes('MANAGER');
  const effectiveTeam = getEffectiveTeam(user);
  
  // Determine default module based on user's team (or role for leads)
  const getDefaultModule = () => {
    if (urlModule === 'qa' || urlModule === 'dev' || urlModule === 'comparison') {
      if (canViewAllModules) return urlModule;
      if (urlModule === 'comparison') return urlModule;
      if (urlModule === 'qa' && effectiveTeam === 'QA') return 'qa';
      if (urlModule === 'dev' && effectiveTeam === 'DEVELOPMENT') return 'dev';
    }
    if (effectiveTeam === 'QA') return 'qa';
    return 'dev';
  };
  
  const [subModule, setSubModule] = useState(getDefaultModule); // 'dev' | 'qa' | 'comparison'

  useEffect(() => {
    if (urlModule === 'comparison') {
      setSubModule('comparison');
    } else if (canViewAllModules) {
      if (urlModule === 'qa') setSubModule('qa');
      else if (urlModule === 'dev') setSubModule('dev');
    } else {
      // Dev tab hidden for QA; QA tab hidden for Dev — enforce correct tab for team
      if (urlModule === 'qa' && effectiveTeam === 'QA') setSubModule('qa');
      else if (urlModule === 'dev' && effectiveTeam === 'DEVELOPMENT') setSubModule('dev');
      else if (!urlModule && effectiveTeam === 'QA') setSubModule('qa');
      else if (!urlModule && effectiveTeam === 'DEVELOPMENT') setSubModule('dev');
      else if (effectiveTeam === 'QA') setSubModule('qa');   // QA user on dev URL → show QA
      else if (effectiveTeam === 'DEVELOPMENT') setSubModule('dev'); // Dev user on qa URL → show Dev
    }
  }, [urlModule, canViewAllModules, effectiveTeam]);

  const selectModule = (mod) => {
    setSubModule(mod);
    setSearchParams(mod === 'dev' ? {} : { module: mod });
  };

  return (
    <div className="dashboard">
      <AppSidebar />
      <main className="main-content">
        <div className="task-planning-page">
          <header className="task-planning-main-header">
            <div className="task-planning-main-title-row">
              <Link to="/" className="task-planning-back">← Dashboard</Link>
              <h1 className="task-planning-main-title">Task Planning</h1>
            </div>
            <nav className="task-planning-sub-nav" aria-label="Task Planning sub-modules">
              {/* Show Dev tab for DEV team/role or Managers/Admins */}
              {(canViewAllModules || effectiveTeam === 'DEVELOPMENT') && (
                <button
                  type="button"
                  className={`task-planning-sub-tab ${subModule === 'dev' ? 'active' : ''}`}
                  onClick={() => selectModule('dev')}
                >
                  Dev
                </button>
              )}
              {/* Show QA tab for QA team/role or Managers/Admins */}
              {(canViewAllModules || effectiveTeam === 'QA') && (
                <button
                  type="button"
                  className={`task-planning-sub-tab ${subModule === 'qa' ? 'active' : ''}`}
                  onClick={() => selectModule('qa')}
                >
                  QA
                </button>
              )}
              {/* Plan vs Actual is available to everyone */}
              <button
                type="button"
                className={`task-planning-sub-tab ${subModule === 'comparison' ? 'active' : ''}`}
                onClick={() => selectModule('comparison')}
              >
                Plan vs Actual
              </button>
            </nav>
          </header>

      {subModule === 'dev' && (
        <DevelopmentTaskPlanning showParentTitle={false} />
      )}

      {subModule === 'qa' && (
        <QATaskPlanning showParentTitle={false} />
      )}

      {subModule === 'comparison' && (
        <PlanComparison showParentTitle={false} />
      )}
    </div>
      </main>
    </div>
  );
}

export default TaskPlanning;
