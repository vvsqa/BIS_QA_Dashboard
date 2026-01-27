import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';

const API_BASE = 'http://localhost:8000';

function PerformanceReview() {
  const { employeeId } = useParams();
  const navigate = useNavigate();
  const [employee, setEmployee] = useState(null);
  const [performance, setPerformance] = useState(null);
  const [goals, setGoals] = useState({ strengths: [], improvements: [] });
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  
  const [review, setReview] = useState({
    review_period: new Date().getFullYear().toString(),
    review_date: new Date().toISOString().split('T')[0],
    technical_rating: 3,
    productivity_rating: 3,
    quality_rating: 3,
    communication_rating: 3,
    strengths_summary: '',
    improvements_summary: '',
    manager_comments: '',
    recommendation: 'retain',
    salary_hike_percent: null,
    reviewed_by: ''
  });

  useEffect(() => {
    loadData();
  }, [employeeId]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [empRes, perfRes, goalsRes] = await Promise.all([
        fetch(`${API_BASE}/employees/${employeeId}`),
        fetch(`${API_BASE}/employees/${employeeId}/performance?period=one_year`),
        fetch(`${API_BASE}/employees/${employeeId}/goals`)
      ]);

      if (empRes.ok) setEmployee(await empRes.json());
      if (perfRes.ok) {
        const perfData = await perfRes.json();
        setPerformance(perfData);
      }
      if (goalsRes.ok) {
        const goalsData = await goalsRes.json();
        setGoals(goalsData);
        // Pre-fill summaries from goals
        const strengthsList = goalsData.strengths.map(s => s.title).join('\n• ');
        const improvementsList = goalsData.improvements.map(i => i.title).join('\n• ');
        setReview(prev => ({
          ...prev,
          strengths_summary: strengthsList ? '• ' + strengthsList : '',
          improvements_summary: improvementsList ? '• ' + improvementsList : ''
        }));
      }
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!review.reviewed_by) {
      alert('Please enter your name as reviewer');
      return;
    }
    
    setSubmitting(true);
    try {
      const res = await fetch(`${API_BASE}/employees/${employeeId}/reviews`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(review)
      });

      if (res.ok) {
        alert('Review saved successfully!');
        navigate(`/employees/${employeeId}`);
      } else {
        const error = await res.json();
        alert(error.detail || 'Failed to save review');
      }
    } catch (error) {
      alert('Error saving review: ' + error.message);
    } finally {
      setSubmitting(false);
    }
  };

  const renderStarRating = (field, value) => {
    return (
      <div className="star-rating-input">
        {[1, 2, 3, 4, 5].map(star => (
          <span
            key={star}
            className={`star ${star <= value ? 'filled' : ''}`}
            onClick={() => setReview({ ...review, [field]: star })}
          >
            {star <= value ? '★' : '☆'}
          </span>
        ))}
      </div>
    );
  };

  const getRAGColor = (status) => {
    if (status === 'GREEN') return '#2e7d32';
    if (status === 'AMBER') return '#f9a825';
    return '#c62828';
  };

  if (loading) {
    return <div className="loading-screen">Loading review data...</div>;
  }

  if (!employee) {
    return <div className="error-screen">Employee not found</div>;
  }

  const ragStatus = performance?.rag_status || {};
  const overallRating = (review.technical_rating + review.productivity_rating + 
                         review.quality_rating + review.communication_rating) / 4;

  return (
    <div className="performance-review">
      <div className="review-header">
        <button className="btn-back" onClick={() => navigate(`/employees/${employeeId}`)}>
          ← Back to Profile
        </button>
        <h1>YEARLY PERFORMANCE REVIEW - {review.review_period}</h1>
      </div>

      <form onSubmit={handleSubmit}>
        {/* Employee Info & Auto RAG */}
        <div className="review-top-section">
          <div className="employee-info-card">
            <h3>{employee.name}</h3>
            <p><strong>ID:</strong> {employee.employee_id}</p>
            <p><strong>Team:</strong> {employee.team}</p>
            <p><strong>Role:</strong> {employee.role}</p>
            <p><strong>Lead:</strong> {employee.lead}</p>
            <p><strong>Experience:</strong> {employee.experience_years} years</p>
          </div>
          
          <div className="auto-rag-card" style={{ borderColor: getRAGColor(ragStatus.status) }}>
            <h4>AUTO RAG SCORE</h4>
            <div className="rag-display">
              <span className="rag-emoji">
                {ragStatus.status === 'GREEN' ? '🟢' : ragStatus.status === 'AMBER' ? '🟡' : '🔴'}
              </span>
              <span className="rag-score">{ragStatus.score || 0}/100</span>
            </div>
            <p className="rag-note">Calculated from performance metrics</p>
          </div>

          <div className="review-period-card">
            <div className="form-group">
              <label>Review Period</label>
              <input
                type="text"
                value={review.review_period}
                onChange={e => setReview({ ...review, review_period: e.target.value })}
                placeholder="2025"
              />
            </div>
            <div className="form-group">
              <label>Review Date</label>
              <input
                type="date"
                value={review.review_date}
                onChange={e => setReview({ ...review, review_date: e.target.value })}
              />
            </div>
          </div>
        </div>

        {/* Manager Ratings Section */}
        <div className="ratings-section">
          <h3>MANAGER RATINGS (1-5 Stars)</h3>
          <div className="ratings-grid">
            <div className="rating-row">
              <label>Technical Skills</label>
              {renderStarRating('technical_rating', review.technical_rating)}
            </div>
            <div className="rating-row">
              <label>Productivity</label>
              {renderStarRating('productivity_rating', review.productivity_rating)}
            </div>
            <div className="rating-row">
              <label>Quality of Work</label>
              {renderStarRating('quality_rating', review.quality_rating)}
            </div>
            <div className="rating-row">
              <label>Communication</label>
              {renderStarRating('communication_rating', review.communication_rating)}
            </div>
            <div className="rating-row overall">
              <label>OVERALL</label>
              <div className="overall-rating">
                <span className="overall-stars">
                  {'★'.repeat(Math.round(overallRating))}{'☆'.repeat(5 - Math.round(overallRating))}
                </span>
                <span className="overall-score">({overallRating.toFixed(1)})</span>
              </div>
            </div>
          </div>
        </div>

        {/* Summary Section */}
        <div className="summary-section">
          <h3>SUMMARY</h3>
          <div className="summary-grid">
            <div className="form-group">
              <label>Strengths</label>
              <textarea
                rows={5}
                value={review.strengths_summary}
                onChange={e => setReview({ ...review, strengths_summary: e.target.value })}
                placeholder="List key strengths..."
              />
            </div>
            <div className="form-group">
              <label>Areas of Improvement</label>
              <textarea
                rows={5}
                value={review.improvements_summary}
                onChange={e => setReview({ ...review, improvements_summary: e.target.value })}
                placeholder="List areas that need improvement..."
              />
            </div>
          </div>
          <div className="form-group">
            <label>Manager Comments</label>
            <textarea
              rows={4}
              value={review.manager_comments}
              onChange={e => setReview({ ...review, manager_comments: e.target.value })}
              placeholder="Additional comments, observations, or feedback..."
            />
          </div>
        </div>

        {/* Recommendation Section */}
        <div className="recommendation-section">
          <h3>RECOMMENDATION</h3>
          <div className="recommendation-options">
            {['retain', 'promote', 'pip', 'release'].map(option => (
              <label key={option} className={`recommendation-option ${review.recommendation === option ? 'selected' : ''}`}>
                <input
                  type="radio"
                  name="recommendation"
                  value={option}
                  checked={review.recommendation === option}
                  onChange={e => setReview({ ...review, recommendation: e.target.value })}
                />
                <span className={`option-label ${option}`}>
                  {option === 'retain' && 'Retain'}
                  {option === 'promote' && 'Promote'}
                  {option === 'pip' && 'PIP Required'}
                  {option === 'release' && 'Release'}
                </span>
              </label>
            ))}
          </div>
          
          <div className="hike-section">
            <label>Recommended Salary Hike (%)</label>
            <input
              type="number"
              min="0"
              max="50"
              step="0.5"
              value={review.salary_hike_percent || ''}
              onChange={e => setReview({ ...review, salary_hike_percent: e.target.value ? parseFloat(e.target.value) : null })}
              placeholder="e.g., 10"
            />
          </div>
        </div>

        {/* Reviewer Info */}
        <div className="reviewer-section">
          <div className="form-group">
            <label>Reviewed By *</label>
            <input
              type="text"
              required
              value={review.reviewed_by}
              onChange={e => setReview({ ...review, reviewed_by: e.target.value })}
              placeholder="Your name"
            />
          </div>
        </div>

        {/* Actions */}
        <div className="review-actions">
          <button type="button" className="btn-cancel" onClick={() => navigate(`/employees/${employeeId}`)}>
            Cancel
          </button>
          <button type="submit" className="btn-submit" disabled={submitting}>
            {submitting ? 'Saving...' : 'Save Review'}
          </button>
        </div>
      </form>
    </div>
  );
}

export default PerformanceReview;
