import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatAPIDate, formatDateRange } from './dateUtils';
import './TaskPlanning.css';

const API_BASE = 'http://localhost:8000';

// Helper function to format date as YYYY-MM-DD (for API calls)
const formatDate = formatAPIDate;

// Helper function to get week start (Monday)
const getWeekStart = (date) => {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(d.setDate(diff));
};

// Helper function to get week days
const getWeekDays = (weekStart) => {
  const days = [];
  for (let i = 0; i < 7; i++) {
    const day = new Date(weekStart);
    day.setDate(day.getDate() + i);
    days.push(day);
  }
  return days;
};

// Day names
const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function TaskPlanning() {
  const navigate = useNavigate();
  
  // State
  const [team, setTeam] = useState('ALL');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [planningData, setPlanningData] = useState(null);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'dark');
  
  // Task form state
  const [showTaskForm, setShowTaskForm] = useState(false);
  const [taskForm, setTaskForm] = useState({
    employee_name: '',
    ticket_id: '',
    task_title: '',
    task_description: '',
    project_name: '',
    planned_date: '',
    planned_hours: 8,
    priority: 'medium',
    team: 'QA'
  });
  const [editingTask, setEditingTask] = useState(null);
  
  // Drag and drop state
  const [draggedTask, setDraggedTask] = useState(null);

  // Calculate week boundaries
  const weekStart = useMemo(() => getWeekStart(currentDate), [currentDate]);
  const weekDays = useMemo(() => getWeekDays(weekStart), [weekStart]);

  // Fetch planning data
  const fetchPlanningData = useCallback(async () => {
    setLoading(true);
    setError(null);
    
    try {
      const url = `${API_BASE}/planning/weekly?team=${team}&week_start=${formatDate(weekStart)}`;
      const response = await fetch(url);
      if (!response.ok) throw new Error('Failed to fetch planning data');
      const data = await response.json();
      setPlanningData(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [team, weekStart]);

  // Fetch employees
  const fetchEmployees = useCallback(async () => {
    try {
      const url = team !== 'ALL' 
        ? `${API_BASE}/employees?team=${team}`
        : `${API_BASE}/employees`;
      const response = await fetch(url);
      if (response.ok) {
        const data = await response.json();
        setEmployees(data);
      }
    } catch (err) {
      console.error('Failed to fetch employees:', err);
    }
  }, [team]);

  // Create task
  const handleCreateTask = async () => {
    try {
      const response = await fetch(`${API_BASE}/planning/task`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...taskForm,
          assigned_by: 'Lead' // TODO: Get from auth
        })
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Failed to create task');
      }
      
      setShowTaskForm(false);
      resetTaskForm();
      fetchPlanningData();
    } catch (err) {
      alert(err.message);
    }
  };

  // Update task
  const handleUpdateTask = async () => {
    if (!editingTask) return;
    
    try {
      const response = await fetch(`${API_BASE}/planning/task/${editingTask.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          task_title: taskForm.task_title,
          task_description: taskForm.task_description,
          planned_hours: taskForm.planned_hours,
          priority: taskForm.priority,
          status: taskForm.status
        })
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Failed to update task');
      }
      
      setShowTaskForm(false);
      setEditingTask(null);
      resetTaskForm();
      fetchPlanningData();
    } catch (err) {
      alert(err.message);
    }
  };

  // Delete task
  const handleDeleteTask = async (taskId) => {
    if (!window.confirm('Are you sure you want to delete this task?')) return;
    
    try {
      const response = await fetch(`${API_BASE}/planning/task/${taskId}`, {
        method: 'DELETE'
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Failed to delete task');
      }
      
      fetchPlanningData();
    } catch (err) {
      alert(err.message);
    }
  };

  // Reset task form
  const resetTaskForm = () => {
    setTaskForm({
      employee_name: '',
      ticket_id: '',
      task_title: '',
      task_description: '',
      project_name: '',
      planned_date: '',
      planned_hours: 8,
      priority: 'medium',
      team: team !== 'ALL' ? team : 'QA'
    });
  };

  // Open add task form
  const openAddTaskForm = (employeeName, date) => {
    setEditingTask(null);
    setTaskForm({
      ...taskForm,
      employee_name: employeeName || '',
      planned_date: date || formatDate(weekStart),
      team: team !== 'ALL' ? team : 'QA'
    });
    setShowTaskForm(true);
  };

  // Open edit task form
  const openEditTaskForm = (task) => {
    setEditingTask(task);
    setTaskForm({
      employee_name: task.employee_name || '',
      ticket_id: task.ticket_id,
      task_title: task.task_title,
      task_description: task.task_description || '',
      project_name: task.project_name || '',
      planned_date: task.date || '',
      planned_hours: task.planned_hours,
      priority: task.priority,
      status: task.status,
      team: team !== 'ALL' ? team : 'QA'
    });
    setShowTaskForm(true);
  };

  // Navigation handlers
  const goToPrevious = () => {
    const newDate = new Date(currentDate);
    newDate.setDate(newDate.getDate() - 7);
    setCurrentDate(newDate);
  };

  const goToNext = () => {
    const newDate = new Date(currentDate);
    newDate.setDate(newDate.getDate() + 7);
    setCurrentDate(newDate);
  };

  const goToToday = () => {
    setCurrentDate(new Date());
  };

  // Drag handlers
  const handleDragStart = (e, task, fromDay) => {
    setDraggedTask({ ...task, fromDay });
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = async (e, employeeName, toDay) => {
    e.preventDefault();
    if (!draggedTask) return;
    
    // If dropped on same day, do nothing
    if (draggedTask.fromDay === toDay) {
      setDraggedTask(null);
      return;
    }
    
    // Delete old task and create new one with new date
    try {
      // Delete old task
      await fetch(`${API_BASE}/planning/task/${draggedTask.id}`, {
        method: 'DELETE'
      });
      
      // Create new task with new date
      await fetch(`${API_BASE}/planning/task`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employee_name: employeeName,
          ticket_id: draggedTask.ticket_id,
          task_title: draggedTask.task_title,
          task_description: draggedTask.task_description || '',
          project_name: draggedTask.project_name || '',
          planned_date: toDay,
          planned_hours: draggedTask.planned_hours,
          priority: draggedTask.priority,
          team: draggedTask.team || (team !== 'ALL' ? team : 'QA'),
          assigned_by: 'Lead'
        })
      });
      
      fetchPlanningData();
    } catch (err) {
      alert('Failed to move task: ' + err.message);
    }
    
    setDraggedTask(null);
  };

  // Effects
  useEffect(() => {
    fetchPlanningData();
    fetchEmployees();
  }, [fetchPlanningData, fetchEmployees]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  // Get priority color
  const getPriorityClass = (priority) => {
    switch (priority?.toLowerCase()) {
      case 'high': return 'priority-high';
      case 'medium': return 'priority-medium';
      case 'low': return 'priority-low';
      default: return 'priority-medium';
    }
  };

  // Get status color
  const getStatusClass = (status) => {
    switch (status?.toLowerCase()) {
      case 'completed': return 'status-completed';
      case 'in_progress': return 'status-progress';
      case 'cancelled': return 'status-cancelled';
      default: return 'status-planned';
    }
  };

  // Calculate day totals
  const getDayTotal = (employee, dayKey) => {
    const tasks = employee.daily_tasks?.[dayKey] || [];
    return tasks.reduce((sum, t) => sum + (t.planned_hours || 0), 0);
  };

  // Render task card
  const renderTaskCard = (task, employeeName, dayKey) => (
    <div 
      key={task.id}
      className={`task-card ${getPriorityClass(task.priority)} ${getStatusClass(task.status)}`}
      draggable
      onDragStart={(e) => handleDragStart(e, { ...task, employee_name: employeeName }, dayKey)}
    >
      <div className="task-header">
        <span className="task-ticket">#{task.ticket_id}</span>
        <span className="task-hours">{task.planned_hours}h</span>
      </div>
      <div className="task-title">{task.task_title}</div>
      <div className="task-meta">
        <span className={`task-priority ${getPriorityClass(task.priority)}`}>
          {task.priority}
        </span>
        <span className={`task-status ${getStatusClass(task.status)}`}>
          {task.status}
        </span>
      </div>
      <div className="task-actions">
        <button 
          className="task-btn edit"
          onClick={() => openEditTaskForm({ ...task, employee_name: employeeName, date: dayKey })}
          title="Edit"
        >
          ✏️
        </button>
        <button 
          className="task-btn delete"
          onClick={() => handleDeleteTask(task.id)}
          title="Delete"
        >
          🗑️
        </button>
      </div>
    </div>
  );

  // Render planning grid
  const renderPlanningGrid = () => {
    if (!planningData?.employees) return null;

    return (
      <div className="planning-grid">
        <table className="planning-table">
          <thead>
            <tr>
              <th className="employee-col">Employee</th>
              {weekDays.map((day, idx) => (
                <th key={idx} className={`day-header ${day.getDay() === 0 || day.getDay() === 6 ? 'weekend' : ''}`}>
                  <div className="day-name">{DAY_NAMES[idx]}</div>
                  <div className="day-date">{day.getDate()}</div>
                </th>
              ))}
              <th className="total-col">Total</th>
            </tr>
          </thead>
          <tbody>
            {planningData.employees.map((emp, empIdx) => {
              const weekTotal = weekDays.reduce((sum, day) => {
                return sum + getDayTotal(emp, formatDate(day));
              }, 0);
              
              return (
                <tr key={empIdx} className="employee-row">
                  <td className="employee-cell">
                    <div className="employee-info">
                      <span 
                        className="employee-name clickable"
                        onClick={() => emp.employee_id && navigate(`/employees/${emp.employee_id}`)}
                      >
                        {emp.employee_name}
                      </span>
                      <span className="employee-team">{emp.team}</span>
                    </div>
                  </td>
                  {weekDays.map((day, dayIdx) => {
                    const dayKey = formatDate(day);
                    const tasks = emp.daily_tasks?.[dayKey] || [];
                    const dayTotal = getDayTotal(emp, dayKey);
                    const isWeekend = day.getDay() === 0 || day.getDay() === 6;
                    
                    return (
                      <td 
                        key={dayIdx} 
                        className={`day-cell ${isWeekend ? 'weekend' : ''}`}
                        onDragOver={handleDragOver}
                        onDrop={(e) => handleDrop(e, emp.employee_name, dayKey)}
                      >
                        <div className="cell-tasks">
                          {tasks.map(task => renderTaskCard(task, emp.employee_name, dayKey))}
                        </div>
                        <button 
                          className="add-task-btn"
                          onClick={() => openAddTaskForm(emp.employee_name, dayKey)}
                          title="Add task"
                        >
                          + Add Task
                        </button>
                        {dayTotal > 0 && (
                          <div className={`day-total ${dayTotal >= 8 ? 'full' : dayTotal >= 4 ? 'half' : 'low'}`}>
                            {dayTotal}h planned
                          </div>
                        )}
                      </td>
                    );
                  })}
                  <td className={`total-cell ${weekTotal >= 40 ? 'full' : weekTotal >= 20 ? 'half' : ''}`}>
                    <strong>{weekTotal}h</strong>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  // Render task form modal
  const renderTaskForm = () => {
    if (!showTaskForm) return null;

    return (
      <div className="modal-overlay" onClick={() => setShowTaskForm(false)}>
        <div className="modal-content task-form-modal" onClick={e => e.stopPropagation()}>
          <div className="modal-header">
            <h3>{editingTask ? 'Edit Task' : 'Add New Task'}</h3>
            <button className="modal-close" onClick={() => setShowTaskForm(false)}>×</button>
          </div>
          <div className="modal-body">
            <div className="form-group">
              <label>Employee</label>
              <select
                value={taskForm.employee_name}
                onChange={(e) => setTaskForm({...taskForm, employee_name: e.target.value})}
                disabled={!!editingTask}
              >
                <option value="">Select Employee</option>
                {employees.map((emp, idx) => (
                  <option key={idx} value={emp.name}>{emp.name}</option>
                ))}
              </select>
            </div>
            
            <div className="form-row">
              <div className="form-group">
                <label>Ticket ID</label>
                <input
                  type="text"
                  value={taskForm.ticket_id}
                  onChange={(e) => setTaskForm({...taskForm, ticket_id: e.target.value})}
                  placeholder="e.g., 12345"
                  disabled={!!editingTask}
                />
              </div>
              <div className="form-group">
                <label>Planned Date</label>
                <input
                  type="date"
                  value={taskForm.planned_date}
                  onChange={(e) => setTaskForm({...taskForm, planned_date: e.target.value})}
                  disabled={!!editingTask}
                />
              </div>
            </div>
            
            <div className="form-group">
              <label>Task Title</label>
              <input
                type="text"
                value={taskForm.task_title}
                onChange={(e) => setTaskForm({...taskForm, task_title: e.target.value})}
                placeholder="Brief task description"
              />
            </div>
            
            <div className="form-group">
              <label>Description (optional)</label>
              <textarea
                value={taskForm.task_description}
                onChange={(e) => setTaskForm({...taskForm, task_description: e.target.value})}
                placeholder="Detailed description..."
                rows={3}
              />
            </div>
            
            <div className="form-row">
              <div className="form-group">
                <label>Project Name</label>
                <input
                  type="text"
                  value={taskForm.project_name}
                  onChange={(e) => setTaskForm({...taskForm, project_name: e.target.value})}
                  placeholder="Project name"
                />
              </div>
              <div className="form-group">
                <label>Planned Hours</label>
                <input
                  type="number"
                  value={taskForm.planned_hours}
                  onChange={(e) => setTaskForm({...taskForm, planned_hours: parseFloat(e.target.value) || 0})}
                  min="0.5"
                  max="24"
                  step="0.5"
                />
              </div>
            </div>
            
            <div className="form-row">
              <div className="form-group">
                <label>Priority</label>
                <select
                  value={taskForm.priority}
                  onChange={(e) => setTaskForm({...taskForm, priority: e.target.value})}
                >
                  <option value="high">High</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low</option>
                </select>
              </div>
              {editingTask && (
                <div className="form-group">
                  <label>Status</label>
                  <select
                    value={taskForm.status}
                    onChange={(e) => setTaskForm({...taskForm, status: e.target.value})}
                  >
                    <option value="planned">Planned</option>
                    <option value="in_progress">In Progress</option>
                    <option value="completed">Completed</option>
                    <option value="cancelled">Cancelled</option>
                  </select>
                </div>
              )}
              {!editingTask && (
                <div className="form-group">
                  <label>Team</label>
                  <select
                    value={taskForm.team}
                    onChange={(e) => setTaskForm({...taskForm, team: e.target.value})}
                  >
                    <option value="QA">QA</option>
                    <option value="DEV">Development</option>
                  </select>
                </div>
              )}
            </div>
          </div>
          <div className="modal-footer">
            <button className="btn-cancel" onClick={() => setShowTaskForm(false)}>
              Cancel
            </button>
            <button 
              className="btn-save"
              onClick={editingTask ? handleUpdateTask : handleCreateTask}
              disabled={!taskForm.employee_name || !taskForm.ticket_id || !taskForm.task_title}
            >
              {editingTask ? 'Update Task' : 'Create Task'}
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="task-planning-module">
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="logo-section">
          <img src="/techversant-logo.png" alt="Techversant" className="company-logo" />
          <div className="logo-text">
            <span className="logo-title">QA Dashboard</span>
            <span className="logo-subtitle">Planning</span>
          </div>
        </div>

        <nav className="sidebar-nav">
          <a href="/" className="nav-item">
            <span className="nav-icon">📊</span>
            <span>Dashboard</span>
          </a>
          <a href="/tickets" className="nav-item">
            <span className="nav-icon">🎫</span>
            <span>Tickets</span>
          </a>
          <a href="/all-bugs" className="nav-item">
            <span className="nav-icon">🐛</span>
            <span>All Bugs</span>
          </a>
          <a href="/employees" className="nav-item">
            <span className="nav-icon">👥</span>
            <span>Employees</span>
          </a>
          <a href="/calendar" className="nav-item">
            <span className="nav-icon">📅</span>
            <span>Calendar</span>
          </a>
          <a href="/planning" className="nav-item active">
            <span className="nav-icon">📋</span>
            <span>Task Planning</span>
          </a>
          <a href="/comparison" className="nav-item">
            <span className="nav-icon">📊</span>
            <span>Plan vs Actual</span>
          </a>
          <a href="/reports" className="nav-item">
            <span className="nav-icon">📈</span>
            <span>Reports</span>
          </a>
        </nav>

        <div className="sidebar-footer">
          <button 
            className="theme-toggle" 
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          >
            {theme === 'dark' ? '☀️ Light Mode' : '🌙 Dark Mode'}
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="main-content">
        {/* Header */}
        <header className="page-header">
          <div className="header-title">
            <h1>📋 Task Planning</h1>
            <p>Plan and assign tasks for your team members</p>
          </div>
          
          <div className="header-actions">
            <button 
              className="btn-primary"
              onClick={() => openAddTaskForm('', formatDate(weekStart))}
            >
              + New Task
            </button>
            <a href="/comparison" className="btn-secondary">
              📊 View Comparison
            </a>
          </div>
        </header>

        {/* Controls */}
        <div className="planning-controls">
          <div className="control-group">
            {/* Team Filter */}
            <select 
              className="team-select"
              value={team}
              onChange={(e) => setTeam(e.target.value)}
            >
              <option value="ALL">All Teams</option>
              <option value="QA">QA Team</option>
              <option value="DEV">Dev Team</option>
            </select>
          </div>

          <div className="date-navigation">
            <button className="nav-btn" onClick={goToPrevious}>
              ←
            </button>
            <button className="today-btn" onClick={goToToday}>
              Today
            </button>
            <span className="current-period">
              {formatDateRange(weekStart, weekDays[6])}
            </span>
            <button className="nav-btn" onClick={goToNext}>
              →
            </button>
          </div>
        </div>

        {/* Planning Content */}
        <div className="planning-content">
          {loading && (
            <div className="loading-state">
              <div className="spinner"></div>
              <p>Loading planning data...</p>
            </div>
          )}
          
          {error && (
            <div className="error-state">
              <p>⚠️ {error}</p>
              <button onClick={fetchPlanningData}>Retry</button>
            </div>
          )}
          
          {!loading && !error && renderPlanningGrid()}
        </div>

        {/* Legend */}
        <div className="planning-legend">
          <span className="legend-title">Priority:</span>
          <div className="legend-item">
            <span className="legend-badge priority-high">High</span>
          </div>
          <div className="legend-item">
            <span className="legend-badge priority-medium">Medium</span>
          </div>
          <div className="legend-item">
            <span className="legend-badge priority-low">Low</span>
          </div>
          <span className="legend-divider"></span>
          <span className="legend-title">Status:</span>
          <div className="legend-item">
            <span className="legend-badge status-planned">Planned</span>
          </div>
          <div className="legend-item">
            <span className="legend-badge status-progress">In Progress</span>
          </div>
          <div className="legend-item">
            <span className="legend-badge status-completed">Completed</span>
          </div>
        </div>

        {/* Tips */}
        <div className="planning-tips">
          <span className="tip-icon">💡</span>
          <span>Tip: Drag and drop tasks to move them between days. Click on a task to edit.</span>
        </div>
      </main>

      {/* Task Form Modal */}
      {renderTaskForm()}
    </div>
  );
}

export default TaskPlanning;
