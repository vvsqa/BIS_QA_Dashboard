import React, { useState, useEffect } from 'react';
import { useNavigate, Link, useLocation } from 'react-router-dom';
import { useTableSort, SortableHeader } from './useTableSort';
import { apiFetch } from './api';
import { useAuth } from './AuthContext';
import AppSidebar from './AppSidebar';

const getInitials = (name) => {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0][0]?.toUpperCase() || '?';
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
};

const normalizeOptionValue = (value) =>
  String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();

const pickBetterLabel = (currentLabel, nextLabel) => {
  if (!currentLabel) return nextLabel;
  const currentLowerCount = (currentLabel.match(/[a-z]/g) || []).length;
  const nextLowerCount = (nextLabel.match(/[a-z]/g) || []).length;
  return nextLowerCount > currentLowerCount ? nextLabel : currentLabel;
};

const dedupeOptions = (options = []) => {
  const byNormalized = new Map();
  options.forEach((rawValue) => {
    const cleanValue = String(rawValue || '').trim().replace(/\s+/g, ' ');
    if (!cleanValue) return;
    const key = normalizeOptionValue(cleanValue);
    const existing = byNormalized.get(key);
    byNormalized.set(key, pickBetterLabel(existing, cleanValue));
  });

  return Array.from(byNormalized.values()).sort((a, b) => a.localeCompare(b));
};

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
      
      // Filter by employment status
      // Priority: showArchived > filters.employment_status (for notice period filter)
      if (showArchived) {
        params.append('archived', 'true');
      } else if (filters.employment_status === 'Serving Notice Period') {
        params.append('serving_notice', 'true');
      } else {
        // Default: show ongoing employees
        params.append('employment_status', 'Ongoing Employee');
      }

      const employmentForOptions = showArchived ? 'Resigned' : (filters.employment_status || 'Ongoing Employee');
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
  const uniqueTeams = dedupeOptions(filterOptions.teams);
  const uniqueCategories = dedupeOptions(filterOptions.categories);
  const uniqueLeads = dedupeOptions(filterOptions.leads);

  // Table sorting
  const { sortedData: sortedEmployees, sortConfig, handleSort } = useTableSort(employees, {
    defaultSortKey: 'name',
    defaultSortDirection: 'asc'
  });

  return (
    <div className="dashboard employee-list-dashboard">
      <AppSidebar />

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
        {/* Notice Period Quick Filter */}
        <button 
          className={`btn-filter-notice ${filters.employment_status === 'Serving Notice Period' ? 'active' : ''}`}
          onClick={() => {
            if (filters.employment_status === 'Serving Notice Period') {
              setFilters({...filters, employment_status: 'Ongoing Employee'});
              setShowArchived(false);
            } else {
              setFilters({...filters, employment_status: 'Serving Notice Period'});
              setShowArchived(false);
            }
          }}
          style={{
            padding: '6px 12px',
            borderRadius: '6px',
            border: filters.employment_status === 'Serving Notice Period' ? '2px solid #f59e0b' : '1px solid var(--border)',
            background: filters.employment_status === 'Serving Notice Period' ? 'rgba(245, 158, 11, 0.15)' : 'var(--bg-secondary)',
            color: filters.employment_status === 'Serving Notice Period' ? '#f59e0b' : 'var(--text-secondary)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            fontSize: '0.85rem',
            fontWeight: '500'
          }}
        >
          ⏰ Notice Period
        </button>
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
                <th className="align-center">Photo</th>
                <SortableHeader columnKey="name" onSort={handleSort} sortConfig={sortConfig}>Name</SortableHeader>
                <SortableHeader columnKey="designation" onSort={handleSort} sortConfig={sortConfig}>Designation</SortableHeader>
                <SortableHeader columnKey="team" onSort={handleSort} sortConfig={sortConfig} className="align-center">Team</SortableHeader>
                <SortableHeader columnKey="mode_of_work" onSort={handleSort} sortConfig={sortConfig} className="align-center">Mode</SortableHeader>
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
                  <td className="emp-photo-cell align-center">
                    <div className="emp-photo">
                      {emp.photo_url && (
                        <img
                          src={emp.photo_url}
                          alt={`${emp.name || 'Employee'} photo`}
                          className="emp-photo-img"
                          onError={(e) => {
                            e.currentTarget.style.display = 'none';
                          }}
                        />
                      )}
                      <span className="emp-photo-fallback">{getInitials(emp.name)}</span>
                    </div>
                  </td>
                  <td className="emp-name">
                    {emp.name}
                    {emp.employment_status === 'Serving Notice Period' && (
                      <span className="notice-badge" title={`Expected LWD: ${emp.expected_lwd || 'TBD'}`}>
                        ⏰
                      </span>
                    )}
                  </td>
                  <td className="emp-designation">{emp.designation || emp.role || '-'}</td>
                  <td className={`emp-team ${emp.team?.toLowerCase()} align-center`}>{emp.team}</td>
                  <td className="emp-mode align-center">
                    <span className={`mode-badge ${(emp.mode_of_work || 'Onsite').toLowerCase()}`}>
                      {emp.mode_of_work || 'Onsite'}
                    </span>
                  </td>
                  <td className={`emp-category ${emp.category?.toLowerCase().replace('-', '')} align-center`}>
                    {emp.category}
                  </td>
                  <td className="emp-status align-center">
                    <span className={`employment-status-badge ${
                      emp.employment_status === 'Resigned' ? 'resigned' : 
                      emp.employment_status === 'Serving Notice Period' ? 'notice' : 'ongoing'
                    }`}>
                      {emp.employment_status === 'Serving Notice Period' ? 'Notice' : 
                       emp.employment_status === 'Resigned' ? 'Resigned' : 'Active'}
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
                      View
                    </button>
                    {!showArchived && (
                      <Link
                        to={`/planning?employee_id=${emp.employee_id}`}
                        className="btn-plan"
                        onClick={(e) => e.stopPropagation()}
                        title="Plan development tasks"
                      >
                        Plan
                      </Link>
                    )}
                    {/* Archive/Restore buttons */}
                    {(user?.role === 'ADMIN' || user?.role?.includes('MANAGER')) && (
                      <>
                        {showArchived ? (
                          <button
                            className="btn-restore"
                            onClick={async (e) => {
                              e.stopPropagation();
                              if (!window.confirm(`Restore ${emp.name} from archive?`)) return;
                              try {
                                const res = await apiFetch(`/employees/${emp.employee_id}/restore`, { method: 'POST' });
                                if (res.ok) {
                                  loadData();
                                } else {
                                  const err = await res.json();
                                  alert(err.detail || 'Failed to restore employee');
                                }
                              } catch (err) {
                                alert('Error: ' + err.message);
                              }
                            }}
                            title="Restore employee from archive"
                          >
                            ↩ Restore
                          </button>
                        ) : emp.employment_status === 'Resigned' ? (
                          <button
                            className="btn-archive"
                            onClick={async (e) => {
                              e.stopPropagation();
                              if (!window.confirm(`Archive ${emp.name}? This will move them to the archived list.`)) return;
                              try {
                                const res = await apiFetch(`/employees/${emp.employee_id}/archive`, { method: 'POST' });
                                if (res.ok) {
                                  loadData();
                                } else {
                                  const err = await res.json();
                                  alert(err.detail || 'Failed to archive employee');
                                }
                              } catch (err) {
                                alert('Error: ' + err.message);
                              }
                            }}
                            title="Archive resigned employee"
                          >
                            📦 Archive
                          </button>
                        ) : null}
                      </>
                    )}
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
