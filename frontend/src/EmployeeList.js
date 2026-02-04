import React, { useState, useEffect } from 'react';
import { useNavigate, Link, useLocation } from 'react-router-dom';
import { useTableSort, SortableHeader } from './useTableSort';
import { apiFetch } from './api';
import { useAuth } from './AuthContext';

function EmployeeList() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const [employees, setEmployees] = useState([]);
  const [teamOverview, setTeamOverview] = useState(null);
  const [filterOptions, setFilterOptions] = useState({ teams: [], categories: [], leads: [] });
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    team: '',
    category: '',
    lead: '',
    search: '',
    employment_status: 'Ongoing Employee' // Default: show only ongoing employees
  });
  const [showArchived, setShowArchived] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newEmployee, setNewEmployee] = useState({
    employee_id: '',
    name: '',
    email: '',
    role: '',
    location: 'Trivandrum',
    team: 'DEVELOPMENT',
    category: 'BILLED',
    employment_status: 'Ongoing Employee',
    lead: ''
  });

  useEffect(() => {
    loadData();
  }, [filters, showArchived]);

  const loadData = async () => {
    setLoading(true);
    try {
      // Build query params
      const params = new URLSearchParams();
      if (filters.team) params.append('team', filters.team);
      if (filters.category) params.append('category', filters.category);
      if (filters.lead) params.append('lead', filters.lead);
      if (filters.search) params.append('search', filters.search);
      // Filter by employment status - show only ongoing by default unless archive is toggled
      if (showArchived) {
        params.append('employment_status', 'Resigned');
      } else {
        params.append('employment_status', 'Ongoing Employee');
      }

      const employmentForOptions = showArchived ? 'Resigned' : 'Ongoing Employee';
      const [empRes, overviewRes, optionsRes] = await Promise.all([
        apiFetch(`/employees?${params}`),
        apiFetch(`/employees/team-overview`),
        apiFetch(`/employees/filter-options?employment_status=${encodeURIComponent(employmentForOptions)}`)
      ]);

      const empData = await empRes.json();
      const overviewData = await overviewRes.json();
      const optionsData = optionsRes.ok ? await optionsRes.json() : { teams: [], categories: [], leads: [] };

      setEmployees(empData);
      setTeamOverview(overviewData);
      setFilterOptions(optionsData);
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleAddEmployee = async (e) => {
    e.preventDefault();
    try {
      const res = await apiFetch(`/employees`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newEmployee)
      });
      
      if (res.ok) {
        setShowAddModal(false);
        setNewEmployee({
          employee_id: '',
          name: '',
          email: '',
          role: '',
          location: 'Trivandrum',
          team: 'DEVELOPMENT',
          category: 'BILLED',
          employment_status: 'Ongoing Employee',
          lead: ''
        });
        loadData();
      } else {
        const error = await res.json();
        alert(error.detail || 'Failed to add employee');
      }
    } catch (error) {
      alert('Error adding employee: ' + error.message);
    }
  };

  const handleExportAll = async () => {
    try {
      // Build query params for filters (same as list view)
      const params = new URLSearchParams();
      if (filters.team) params.append('team', filters.team);
      if (filters.category) params.append('category', filters.category);
      if (filters.lead) params.append('lead', filters.lead);
      if (filters.search) params.append('search', filters.search);
      if (!showArchived) {
        params.append('employment_status', 'Ongoing Employee');
      } else {
        params.append('employment_status', 'Resigned');
      }
      
      const response = await apiFetch(`/employees/export-all?${params}`);
      
      if (!response.ok) {
        throw new Error('Failed to export employees');
      }
      
      // Get filename from Content-Disposition header or use default
      const contentDisposition = response.headers.get('Content-Disposition');
      let filename = `Employee_Profiles_Export_${new Date().toISOString().split('T')[0]}.xlsx`;
      if (contentDisposition) {
        const filenameMatch = contentDisposition.match(/filename="?(.+)"?/i);
        if (filenameMatch) {
          filename = filenameMatch[1];
        }
      }
      
      // Create blob and download
      const blob = await response.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(downloadUrl);
      document.body.removeChild(a);
    } catch (error) {
      alert('Error exporting employees: ' + error.message);
    }
  };

  const handleImportMapping = async () => {
    if (!window.confirm('This will import mapping data from the latest Employee_Profiles_Export_*.xlsx file in your Downloads folder. Continue?')) {
      return;
    }
    
    try {
      const response = await apiFetch(`/employees/import-mapping`, {
        method: 'POST'
      });
      
      const result = await response.json();
      
      if (!response.ok) {
        throw new Error(result.detail || 'Failed to import mapping data');
      }
      
      let message = `✅ Successfully imported mapping data for ${result.updated_count} employees.`;
      if (result.not_found && result.not_found.length > 0) {
        message += `\n\n⚠️ ${result.not_found.length} employee ID(s) not found: ${result.not_found.join(', ')}`;
      }
      message += `\n\nFile used: ${result.file_used}`;
      
      alert(message);
      
      // Reload data to show updated information
      loadData();
    } catch (error) {
      alert('Error importing mapping data: ' + error.message);
    }
  };

  const getRAGColor = (score) => {
    if (score >= 70) return '#2e7d32'; // Green
    if (score >= 50) return '#f9a825'; // Amber
    return '#c62828'; // Red
  };

  const getRAGEmoji = (score) => {
    if (score >= 70) return '🟢';
    if (score >= 50) return '🟡';
    return '🔴';
  };

  // Filter dropdown options from API (so all teams/leads are listed regardless of current filter)
  const uniqueTeams = filterOptions.teams || [];
  const uniqueCategories = filterOptions.categories || [];
  const uniqueLeads = filterOptions.leads || [];

  // Table sorting
  const { sortedData: sortedEmployees, sortConfig, handleSort } = useTableSort(employees, {
    defaultSortKey: 'name',
    defaultSortDirection: 'asc'
  });

  return (
    <div className="dashboard employee-list-dashboard">
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="logo">
          <div className="logo-icon">QA</div>
          <span className="logo-text">Bug Tracker</span>
        </div>
        <nav className="nav-menu">
          <Link to="/" className={`nav-item ${location.pathname === '/' || location.pathname === '/ticket' ? 'active' : ''}`}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
            Ticket Dashboard
          </Link>
          <Link to="/all-bugs" className={`nav-item ${location.pathname === '/all-bugs' ? 'active' : ''}`}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4l2 2"/></svg>
            All Bugs Dashboard
          </Link>
          <Link to="/tickets" className={`nav-item ${location.pathname === '/tickets' ? 'active' : ''}`}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/></svg>
            Tickets Overview
          </Link>
          {(user?.role === 'ADMIN' || user?.role?.includes('MANAGER') || user?.role?.includes('LEAD')) && (
            <Link to="/employees" className={`nav-item ${location.pathname.startsWith('/employees') ? 'active' : ''}`}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></svg>
              Employees
            </Link>
          )}
          <Link to="/calendar" className={`nav-item ${location.pathname === '/calendar' ? 'active' : ''}`}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
            Calendar
          </Link>
          {user?.employee_id && !user?.role?.includes('MANAGER') && (
            <Link to="/my-tasks" className={`nav-item ${location.pathname === '/my-tasks' ? 'active' : ''}`}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>
              My Tasks
            </Link>
          )}
          {(user?.role === 'ADMIN' || user?.role?.includes('LEAD')) && (
            <Link to="/planning" className={`nav-item ${location.pathname === '/planning' ? 'active' : ''}`}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01"/></svg>
              Task Planning
            </Link>
          )}
          <Link to="/reports" className={`nav-item ${location.pathname === '/reports' ? 'active' : ''}`}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
            Reports
          </Link>
        </nav>
      </aside>

      {/* Main Content */}
      <main className="main-content">
        <div className="employee-dashboard">
          {/* Header */}
          <div className="emp-header">
            <div className="emp-header-left">
              <img src="/techversant-logo.png" alt="Techversant Infotech" className="company-logo" style={{ height: '36px', marginRight: '16px' }} />
              <h1>RESOURCE PERFORMANCE DASHBOARD</h1>
            </div>
            <div className="emp-header-actions">
          <button 
            className={`btn-secondary ${showArchived ? 'active' : ''}`}
            onClick={() => setShowArchived(!showArchived)}
            style={{ marginRight: '10px' }}
          >
            {showArchived ? '📁 Show Active' : '📦 Show Archived'}
          </button>
          <button 
            className="btn-secondary" 
            onClick={handleExportAll}
            style={{ marginRight: '10px' }}
            title="Export all employees to Excel with mapping columns"
          >
            📥 Export Excel
          </button>
          <button 
            className="btn-secondary" 
            onClick={handleImportMapping}
            style={{ marginRight: '10px' }}
            title="Import mapping data from latest Excel file in Downloads folder"
          >
            📤 Import Mapping Data
          </button>
          {(user?.role === 'ADMIN' || user?.role?.includes('MANAGER')) && (
            <button className="btn-primary" onClick={() => setShowAddModal(true)}>
              + Add Employee
            </button>
          )}
          <button className="btn-secondary" onClick={() => navigate('/')}>
            ← Back to Dashboard
          </button>
        </div>
      </div>

      {/* Team Overview Cards */}
      {teamOverview && (
        <div className="team-overview-cards">
          <div className="team-card dev-card">
            <div className="team-card-header">DEV TEAM</div>
            <div className="team-card-count">{teamOverview.team_breakdown?.DEVELOPMENT?.total || 0}</div>
            <div className="team-card-details">
              <span className="billed">Billed: {teamOverview.team_breakdown?.DEVELOPMENT?.billed || 0}</span>
              <span className="unbilled">Un-billed: {teamOverview.team_breakdown?.DEVELOPMENT?.unbilled || 0}</span>
            </div>
          </div>
          <div className="team-card qa-card">
            <div className="team-card-header">QA TEAM</div>
            <div className="team-card-count">{teamOverview.team_breakdown?.QA?.total || 0}</div>
            <div className="team-card-details">
              <span className="billed">Billed: {teamOverview.team_breakdown?.QA?.billed || 0}</span>
              <span className="unbilled">Un-billed: {teamOverview.team_breakdown?.QA?.unbilled || 0}</span>
            </div>
          </div>
          <div className="team-card total-card">
            <div className="team-card-header">TOTAL</div>
            <div className="team-card-count">{teamOverview.total_employees || 0}</div>
            <div className="team-card-details">
              <span>Active Resources</span>
            </div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="emp-filters">
        <div className="filter-group">
          <label>Team:</label>
          <select 
            value={filters.team} 
            onChange={(e) => setFilters({...filters, team: e.target.value})}
          >
            <option value="">All Teams</option>
            {uniqueTeams.map(t => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
        <div className="filter-group">
          <label>Category:</label>
          <select 
            value={filters.category} 
            onChange={(e) => setFilters({...filters, category: e.target.value})}
          >
            <option value="">All Categories</option>
            {uniqueCategories.length > 0 ? uniqueCategories.map(c => (
              <option key={c} value={c}>{c}</option>
            )) : (
              <>
                <option value="BILLED">Billed</option>
                <option value="UN-BILLED">Un-billed</option>
              </>
            )}
          </select>
        </div>
        <div className="filter-group">
          <label>Lead:</label>
          <select 
            value={filters.lead} 
            onChange={(e) => setFilters({...filters, lead: e.target.value})}
          >
            <option value="">All Leads</option>
            {uniqueLeads.map(lead => (
              <option key={lead} value={lead}>{lead}</option>
            ))}
          </select>
        </div>
        <div className="filter-group search-group">
          <label>Search:</label>
          <input 
            type="text"
            placeholder="Name, ID, or Email..."
            value={filters.search}
            onChange={(e) => setFilters({...filters, search: e.target.value})}
          />
        </div>
      </div>

      {/* Archive Notice */}
      {showArchived && (
        <div style={{
          padding: '12px 16px',
          margin: '16px 0',
          backgroundColor: '#fef3c7',
          border: '1px solid #fbbf24',
          borderRadius: '8px',
          color: '#92400e',
          display: 'flex',
          alignItems: 'center',
          gap: '8px'
        }}>
          <span>📦</span>
          <span><strong>Viewing Archived Employees (Resigned)</strong> - Click "Show Active" to return to active employees.</span>
        </div>
      )}

      {/* Employee Table */}
      <div className="emp-table-container">
        {loading ? (
          <div className="loading">Loading employees...</div>
        ) : (
          <table className="emp-table">
            <thead>
              <tr>
                <SortableHeader columnKey="employee_id" onSort={handleSort} sortConfig={sortConfig}>ID</SortableHeader>
                <SortableHeader columnKey="name" onSort={handleSort} sortConfig={sortConfig}>Name</SortableHeader>
                <SortableHeader columnKey="role" onSort={handleSort} sortConfig={sortConfig}>Role</SortableHeader>
                <SortableHeader columnKey="team" onSort={handleSort} sortConfig={sortConfig} className="align-center">Team</SortableHeader>
                <SortableHeader columnKey="category" onSort={handleSort} sortConfig={sortConfig} className="align-center">Category</SortableHeader>
                <SortableHeader columnKey="employment_status" onSort={handleSort} sortConfig={sortConfig} className="align-center">Status</SortableHeader>
                <SortableHeader columnKey="lead" onSort={handleSort} sortConfig={sortConfig} className="align-center">Lead</SortableHeader>
                <SortableHeader columnKey="experience_years" onSort={handleSort} sortConfig={sortConfig} className="align-center">Experience</SortableHeader>
                <th className="align-center">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sortedEmployees.map(emp => (
                <tr key={emp.employee_id} onClick={() => navigate(`/employees/${emp.employee_id}`)}>
                  <td className="emp-id">{emp.employee_id}</td>
                  <td className="emp-name">{emp.name}</td>
                  <td className="emp-role">{emp.role}</td>
                  <td className={`emp-team ${emp.team?.toLowerCase()} align-center`}>{emp.team}</td>
                  <td className={`emp-category ${emp.category?.toLowerCase().replace('-', '')} align-center`}>
                    {emp.category}
                  </td>
                  <td className="emp-status align-center">
                    <span className={`employment-status-badge ${emp.employment_status === 'Resigned' ? 'resigned' : 'ongoing'}`}>
                      {emp.employment_status || 'Ongoing Employee'}
                    </span>
                  </td>
                  <td className="emp-lead align-center">{emp.lead}</td>
                  <td className="emp-exp align-center">{emp.experience_years}y</td>
                  <td className="emp-actions align-center">
                    <button 
                      className="btn-view"
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(`/employees/${emp.employee_id}`);
                      }}
                    >
                      View Profile
                    </button>
                    <Link
                      to={`/planning?employee_id=${emp.employee_id}`}
                      className="btn-view"
                      onClick={(e) => e.stopPropagation()}
                      title="Plan development tasks"
                    >
                      Plan
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Leads Summary */}
      {teamOverview?.leads && Object.keys(teamOverview.leads).length > 0 && (
        <div className="leads-summary">
          <h3>Team Leads Summary</h3>
          <div className="leads-grid">
            {Object.entries(teamOverview.leads).map(([lead, data]) => (
              <div key={lead} className="lead-card" onClick={() => setFilters({...filters, lead})}>
                <div className="lead-name">{lead}</div>
                <div className="lead-counts">
                  <span className="total">{data.total} members</span>
                  {data.dev > 0 && <span className="dev">DEV: {data.dev}</span>}
                  {data.qa > 0 && <span className="qa">QA: {data.qa}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Add Employee Modal */}
      {showAddModal && (
        <div className="modal-overlay" onClick={() => setShowAddModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <h2>Add New Employee</h2>
            <form onSubmit={handleAddEmployee}>
              <div className="form-row">
                <div className="form-group">
                  <label>Employee ID *</label>
                  <input 
                    type="text" 
                    required
                    placeholder="TV0XXX"
                    value={newEmployee.employee_id}
                    onChange={e => setNewEmployee({...newEmployee, employee_id: e.target.value})}
                  />
                </div>
                <div className="form-group">
                  <label>Name *</label>
                  <input 
                    type="text" 
                    required
                    value={newEmployee.name}
                    onChange={e => setNewEmployee({...newEmployee, name: e.target.value})}
                  />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Email *</label>
                  <input 
                    type="email" 
                    required
                    value={newEmployee.email}
                    onChange={e => setNewEmployee({...newEmployee, email: e.target.value})}
                  />
                </div>
                <div className="form-group">
                  <label>Role</label>
                  <input 
                    type="text"
                    placeholder="SOFTWARE ENGINEER"
                    value={newEmployee.role}
                    onChange={e => setNewEmployee({...newEmployee, role: e.target.value})}
                  />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Team *</label>
                  <select 
                    required
                    value={newEmployee.team}
                    onChange={e => setNewEmployee({...newEmployee, team: e.target.value})}
                  >
                    <option value="DEVELOPMENT">Development</option>
                    <option value="QA">QA</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Category</label>
                  <select 
                    value={newEmployee.category}
                    onChange={e => setNewEmployee({...newEmployee, category: e.target.value})}
                  >
                    <option value="BILLED">Billed</option>
                    <option value="UN-BILLED">Un-billed</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Employment Status</label>
                  <select 
                    value={newEmployee.employment_status}
                    onChange={e => setNewEmployee({...newEmployee, employment_status: e.target.value})}
                  >
                    <option value="Ongoing Employee">Ongoing Employee</option>
                    <option value="Resigned">Resigned</option>
                  </select>
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Location</label>
                  <input 
                    type="text"
                    value={newEmployee.location}
                    onChange={e => setNewEmployee({...newEmployee, location: e.target.value})}
                  />
                </div>
                <div className="form-group">
                  <label>Reporting To (Lead)</label>
                  <input 
                    type="text"
                    value={newEmployee.lead}
                    onChange={e => setNewEmployee({...newEmployee, lead: e.target.value})}
                  />
                </div>
              </div>
              <div className="form-actions">
                <button type="button" className="btn-cancel" onClick={() => setShowAddModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn-submit">
                  Add Employee
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
        </div>
      </main>
    </div>
  );
}

export default EmployeeList;
