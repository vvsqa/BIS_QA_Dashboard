import { BrowserRouter as Router, Routes, Route, useLocation, Navigate } from "react-router-dom";
import { useEffect } from "react";
import Dashboard from "./Dashboard";
import AllBugsDashboard from "./AllBugsDashboard";
import TicketsDashboard from "./TicketsDashboard";
import EmployeeList from "./EmployeeList";
import EmployeeProfile from "./EmployeeProfile";
import PerformanceReview from "./PerformanceReview";
import ReportsModule from "./ReportsModule";
import CalendarModule from "./CalendarModule";
import TimeSheetModule from "./TimeSheetModule";
import TaskPlanning from "./TaskPlanning";
import MyTasks from "./MyTasks";
import Login from "./Login";
import ChangePassword from "./ChangePassword";
import Settings from "./Settings";
import { AuthProvider, useAuth } from "./AuthContext";
import "./dashboard.css";

// ScrollToTop component that scrolls to top on route change
function ScrollToTop() {
  const { pathname, search } = useLocation();

  useEffect(() => {
    // Scroll to top on both pathname and search parameter changes
    window.scrollTo({
      top: 0,
      left: 0,
      behavior: 'smooth' // Smooth scroll for better UX
    });
  }, [pathname, search]);

  return null;
}

// Employees module: Manager sees all, Lead sees reportees, Employee redirects to My Profile
function EmployeesRoute() {
  const { user } = useAuth();
  const isManager = user?.role === 'ADMIN' || user?.role?.includes('MANAGER');
  const isLead = user?.role?.includes('LEAD');
  if (isManager || isLead) {
    return <EmployeeList />;
  }
  if (user?.employee_id) {
    return <Navigate to={`/employees/${user.employee_id}`} replace />;
  }
  return <Navigate to="/" replace />;
}

// Task module (My Tasks, Task Planning) is hidden from managers — redirect them to dashboard
function TaskModuleGuard({ children, allowManager = false }) {
  const { user } = useAuth();
  const isManager = user?.role?.includes('MANAGER') && user?.role !== 'ADMIN';
  if (isManager && !allowManager) {
    return <Navigate to="/" replace />;
  }
  return children;
}

function ProtectedRoute({ children, allowPasswordChange = false }) {
  const { isAuthenticated, loading, needsPasswordChange, lockStatus } = useAuth();
  const location = useLocation();
  
  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-primary)' }}>
        <span style={{ color: 'var(--text-muted)' }}>Loading...</span>
      </div>
    );
  }
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }
  // If user needs password change and not already on change-password page, redirect
  if (needsPasswordChange() && !allowPasswordChange && location.pathname !== '/change-password') {
    return <Navigate to="/change-password" replace />;
  }
  if (lockStatus?.locked && location.pathname !== '/timesheet') {
    return <Navigate to="/timesheet" replace />;
  }
  return children;
}

function AppRoutes() {
  return (
    <>
      <ScrollToTop />
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/change-password" element={<ProtectedRoute allowPasswordChange={true}><ChangePassword /></ProtectedRoute>} />
        <Route path="/" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
        <Route path="/ticket" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
        <Route path="/all-bugs" element={<ProtectedRoute><AllBugsDashboard /></ProtectedRoute>} />
        <Route path="/tickets" element={<ProtectedRoute><TicketsDashboard /></ProtectedRoute>} />
        <Route path="/employees" element={<ProtectedRoute><EmployeesRoute /></ProtectedRoute>} />
        <Route path="/employees/:employeeId" element={<ProtectedRoute><EmployeeProfile /></ProtectedRoute>} />
        <Route path="/employees/:employeeId/review/new" element={<ProtectedRoute><PerformanceReview /></ProtectedRoute>} />
        <Route path="/reports" element={<ProtectedRoute><ReportsModule /></ProtectedRoute>} />
        <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
        <Route path="/calendar" element={<ProtectedRoute><CalendarModule /></ProtectedRoute>} />
        <Route path="/timesheet" element={<ProtectedRoute><TimeSheetModule /></ProtectedRoute>} />
        <Route path="/planning" element={<ProtectedRoute><TaskModuleGuard><TaskPlanning /></TaskModuleGuard></ProtectedRoute>} />
        <Route path="/my-tasks" element={<ProtectedRoute><TaskModuleGuard><MyTasks /></TaskModuleGuard></ProtectedRoute>} />
      </Routes>
    </>
  );
}

function App() {
  return (
    <Router>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </Router>
  );
}

export default App;
