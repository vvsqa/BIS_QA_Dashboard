import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import Dashboard from "./Dashboard";
import AllBugsDashboard from "./AllBugsDashboard";
import "./dashboard.css";

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/ticket" element={<Dashboard />} />
        <Route path="/all-bugs" element={<AllBugsDashboard />} />
      </Routes>
    </Router>
  );
}

export default App;
