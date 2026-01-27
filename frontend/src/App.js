import { BrowserRouter as Router, Routes, Route, useLocation } from "react-router-dom";
import { useEffect } from "react";
import Dashboard from "./Dashboard";
import AllBugsDashboard from "./AllBugsDashboard";
import TicketsDashboard from "./TicketsDashboard";
import EmployeeList from "./EmployeeList";
import EmployeeProfile from "./EmployeeProfile";
import PerformanceReview from "./PerformanceReview";
import ReportsModule from "./ReportsModule";
import CalendarModule from "./CalendarModule";
import TaskPlanning from "./TaskPlanning";
import PlanComparison from "./PlanComparison";
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

function App() {
  return (
    <Router>
      <ScrollToTop />
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/ticket" element={<Dashboard />} />
        <Route path="/all-bugs" element={<AllBugsDashboard />} />
        <Route path="/tickets" element={<TicketsDashboard />} />
        <Route path="/employees" element={<EmployeeList />} />
        <Route path="/employees/:employeeId" element={<EmployeeProfile />} />
        <Route path="/employees/:employeeId/review/new" element={<PerformanceReview />} />
        <Route path="/reports" element={<ReportsModule />} />
        <Route path="/calendar" element={<CalendarModule />} />
        <Route path="/planning" element={<TaskPlanning />} />
        <Route path="/comparison" element={<PlanComparison />} />
      </Routes>
    </Router>
  );
}

export default App;
