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
import ETACalendar from "./ETACalendar";
import QACycleDashboard from "./QACycleDashboard";
import QAMetricsDashboard from "./QAMetricsDashboard";
import AutomationCoverageDashboard from "./AutomationCoverageDashboard";
import QCQueueDashboard from "./QCQueueDashboard";
import TeamBoard from "./TeamBoard";
import QAActivitySummary from "./QAActivitySummary";
import ResourcePlanner from "./ResourcePlanner";
import DevDashboard from "./DevDashboard";
import EmployeePerformance from "./EmployeePerformance";
import TicketSpeed from "./TicketSpeed";
import AutomationUtilization from "./AutomationUtilization";
import TicketCalendar from "./TicketCalendar";
import ClientProfiles from "./ClientProfiles";
import ClientModuleAccess from "./ClientModuleAccess";
import { isPathAllowedForClient } from "./clientModules";
import Login from "./Login";
import ChangePassword from "./ChangePassword";
import Settings from "./Settings";
import { AuthProvider, useAuth } from "./AuthContext";
import { ThemeProvider } from "./ThemeContext";
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

// Task module (My Tasks, Task Planning): managers can access same as admins/leads (QA + Dev planning).
function TaskModuleGuard({ children }) {
  return children;
}

// Reports module: only accessible to managers, leads, and admins
function ReportsRoute() {
  const { user } = useAuth();
  const hasAccess = user?.role === 'ADMIN' || user?.role?.includes('MANAGER') || user?.role?.includes('LEAD');
  if (hasAccess) {
    return <ReportsModule />;
  }
  // Redirect non-authorized users to dashboard
  return <Navigate to="/" replace />;
}

// Reports access guard for multiple routes (returns children if has access)
function ReportsAccessGuard({ children }) {
  const { user } = useAuth();
  const hasAccess = user?.role === 'ADMIN' || user?.role?.includes('MANAGER') || user?.role?.includes('LEAD') || user?.role === 'CLIENT';
  if (hasAccess) {
    return children;
  }
  return <Navigate to="/" replace />;
}

function AdminOnlyRoute({ children }) {
  const { user } = useAuth();
  if (user?.role !== 'ADMIN') {
    return <Navigate to="/" replace />;
  }
  return children;
}

function ProtectedRoute({ children, allowPasswordChange = false }) {
  const { user, isAuthenticated, loading, needsPasswordChange } = useAuth();
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
  if (user?.role === 'CLIENT' && location.pathname !== '/change-password' && !isPathAllowedForClient(location.pathname, user.allowed_modules)) {
    return <Navigate to="/" replace />;
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
        <Route path="/" element={<QCQueueDashboard />} />
        <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
        <Route path="/ticket" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
        <Route path="/eta-calendar" element={<ProtectedRoute><ETACalendar /></ProtectedRoute>} />
        <Route path="/all-bugs" element={<ProtectedRoute><AllBugsDashboard /></ProtectedRoute>} />
        <Route path="/tickets" element={<ProtectedRoute><TicketsDashboard /></ProtectedRoute>} />
        <Route path="/employees" element={<ProtectedRoute><EmployeesRoute /></ProtectedRoute>} />
        <Route path="/employees/:employeeId" element={<ProtectedRoute><EmployeeProfile /></ProtectedRoute>} />
        <Route path="/employees/:employeeId/review/new" element={<ProtectedRoute><PerformanceReview /></ProtectedRoute>} />
        <Route path="/reports" element={<ProtectedRoute><ReportsRoute /></ProtectedRoute>} />
        <Route path="/qa-cycle" element={<ProtectedRoute><ReportsAccessGuard><QACycleDashboard /></ReportsAccessGuard></ProtectedRoute>} />
        <Route path="/qa-metrics" element={<ProtectedRoute><ReportsAccessGuard><QAMetricsDashboard /></ReportsAccessGuard></ProtectedRoute>} />
        {/* Public QA Metrics Dashboard - No authentication required */}
        <Route path="/public/qa-metrics" element={<QAMetricsDashboard isPublic={true} />} />
        <Route path="/automation" element={<ProtectedRoute><ReportsAccessGuard><AutomationCoverageDashboard /></ReportsAccessGuard></ProtectedRoute>} />
        <Route path="/qc-queue" element={<QCQueueDashboard />} />
        <Route path="/team-board" element={<TeamBoard />} />
        <Route path="/qa-summary" element={<QAActivitySummary />} />
        <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
        <Route path="/admin/clients" element={<ProtectedRoute><AdminOnlyRoute><ClientProfiles /></AdminOnlyRoute></ProtectedRoute>} />
        <Route path="/admin/client-modules" element={<ProtectedRoute><AdminOnlyRoute><ClientModuleAccess /></AdminOnlyRoute></ProtectedRoute>} />
        <Route path="/calendar" element={<ProtectedRoute><CalendarModule /></ProtectedRoute>} />
        <Route path="/timesheet" element={<ProtectedRoute><TimeSheetModule /></ProtectedRoute>} />
        <Route path="/planning" element={<ProtectedRoute><TaskModuleGuard><TaskPlanning /></TaskModuleGuard></ProtectedRoute>} />
        <Route path="/my-tasks" element={<ProtectedRoute><TaskModuleGuard><MyTasks /></TaskModuleGuard></ProtectedRoute>} />
      </Routes>
    </>
  );
}

function NewModuleRoutes() {
  return (
    <Routes>
      <Route path="/" element={<QCQueueDashboard />} />
      <Route path="/qc-queue" element={<QCQueueDashboard />} />
      <Route path="/team-board" element={<TeamBoard />} />
      <Route path="/qa-summary" element={<QAActivitySummary />} />
      <Route path="/resource-planner" element={<ResourcePlanner />} />
      <Route path="/dev-dashboard" element={<DevDashboard />} />
      <Route path="/employee-performance" element={<EmployeePerformance />} />
      <Route path="/ticket-speed" element={<TicketSpeed />} />
      <Route path="/automation" element={<AutomationUtilization />} />
      <Route path="/ticket-calendar" element={<TicketCalendar />} />
      <Route path="/calendar" element={<CalendarModule />} />
    </Routes>
  );
}

function IsNewModulePath() {
  const { pathname } = useLocation();
  return ['/', '/qc-queue', '/team-board', '/qa-summary'].includes(pathname);
}

function AppRouter() {
  const location = useLocation();
  const isNew = ['/', '/qc-queue', '/team-board', '/qa-summary', '/resource-planner', '/dev-dashboard', '/employee-performance', '/ticket-speed', '/automation', '/ticket-calendar', '/calendar'].includes(location.pathname);

  if (isNew) {
    return (
      <ThemeProvider>
        <ScrollToTop />
        <NewModuleRoutes />
      </ThemeProvider>
    );
  }

  return (
    <AuthProvider>
      <ThemeProvider>
        <AppRoutes />
      </ThemeProvider>
    </AuthProvider>
  );
}

function App() {
  return (
    <Router>
      <AppRouter />
    </Router>
  );
}

export default App;
