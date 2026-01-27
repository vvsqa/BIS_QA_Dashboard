import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTableSort, SortableHeader } from './useTableSort';

const API_BASE = 'http://localhost:8000';

function EmployeeList() {
  const navigate = useNavigate();
  const [employees, setEmployees] = useState([]);
  const [teamOverview, setTeamOverview] = useState(null);
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

      const [empRes, overviewRes] = await Promise.all([
        fetch(`${API_BASE}/employees?${params}`),
        fetch(`${API_BASE}/employees/team-overview`)
      ]);

      const empData = await empRes.json();
      const overviewData = await overviewRes.json();

      setEmployees(empData);
      setTeamOverview(overviewData);
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleAddEmployee = async (e) => {
    e.preventDefault();
    try {
      const res = await fetch(`${API_BASE}/employees`, {
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
      // Build query params for filters
      const params = new URLSearchParams();
      if (filters.team) params.append('team', filters.team);
      if (filters.category) params.append('category', filters.category);
      if (!showArchived) {
        params.append('employment_status', 'Ongoing Employee');
      } else {
        params.append('employment_status', 'Resigned');
      }
      
      const url = `${API_BASE}/employees/export-all?${params}`;
      const response = await fetch(url);
      
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
      const response = await fetch(`${API_BASE}/employees/import-mapping`, {
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

  // Get unique leads for filter dropdown
  const uniqueLeads = [...new Set(employees.map(e => e.lead).filter(Boolean))];

  // Table sorting
  const { sortedData: sortedEmployees, sortConfig, handleSort } = useTableSort(employees, {
    defaultSortKey: 'name',
    defaultSortDirection: 'asc'
  });

  return (
    <div className="employee-dashboard">
      {/* Header */}
      <div className="emp-header">
        <img 
          src="/techversant-logo.png" 
          alt="Techversant Infotech" 
          className="company-logo"
          style={{ height: '36px', marginRight: '16px' }}
        />
        <h1>RESOURCE PERFORMANCE DASHBOARD</h1>
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
          <button className="btn-primary" onClick={() => setShowAddModal(true)}>
            + Add Employee
          </button>
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
            <option value="DEVELOPMENT">Development</option>
            <option value="QA">QA</option>
          </select>
        </div>
        <div className="filter-group">
          <label>Category:</label>
          <select 
            value={filters.category} 
            onChange={(e) => setFilters({...filters, category: e.target.value})}
          >
            <option value="">All Categories</option>
            <option value="BILLED">Billed</option>
            <option value="UN-BILLED">Un-billed</option>
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
                <SortableHeader columnKey="team" onSort={handleSort} sortConfig={sortConfig}>Team</SortableHeader>
                <SortableHeader columnKey="category" onSort={handleSort} sortConfig={sortConfig}>Category</SortableHeader>
                <SortableHeader columnKey="employment_status" onSort={handleSort} sortConfig={sortConfig}>Status</SortableHeader>
                <SortableHeader columnKey="lead" onSort={handleSort} sortConfig={sortConfig}>Lead</SortableHeader>
                <SortableHeader columnKey="experience_years" onSort={handleSort} sortConfig={sortConfig}>Experience</SortableHeader>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {sortedEmployees.map(emp => (
                <tr key={emp.employee_id} onClick={() => navigate(`/employees/${emp.employee_id}`)}>
                  <td className="emp-id">{emp.employee_id}</td>
                  <td className="emp-name">{emp.name}</td>
                  <td className="emp-role">{emp.role}</td>
                  <td className={`emp-team ${emp.team?.toLowerCase()}`}>{emp.team}</td>
                  <td className={`emp-category ${emp.category?.toLowerCase().replace('-', '')}`}>
                    {emp.category}
                  </td>
                  <td>
                    <span className={`employment-status-badge ${emp.employment_status === 'Resigned' ? 'resigned' : 'ongoing'}`}>
                      {emp.employment_status || 'Ongoing Employee'}
                    </span>
                  </td>
                  <td className="emp-lead">{emp.lead}</td>
                  <td className="emp-exp">{emp.experience_years}y</td>
                  <td className="emp-actions">
                    <button 
                      className="btn-view"
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(`/employees/${emp.employee_id}`);
                      }}
                    >
                      View Profile
                    </button>
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
  );
}

export default EmployeeList;
