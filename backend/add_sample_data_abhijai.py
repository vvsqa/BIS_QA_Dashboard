"""
Add sample data for Abhijai K P (TV0539) to demonstrate the employee profile
"""
from database import SessionLocal
from models import (
    Employee, Bug, Timesheet, EmployeeGoal, EmployeeReview, 
    KPIRating, KPI, TicketTracking
)
from datetime import datetime, timedelta, date
import random

def add_sample_data():
    """Add comprehensive sample data for Abhijai K P"""
    db = SessionLocal()
    try:
        # Find the employee
        employee = db.query(Employee).filter(
            Employee.employee_id == "TV0539"
        ).first()
        
        if not employee:
            print("Employee TV0539 (Abhijai K P) not found!")
            return
        
        print(f"Adding sample data for: {employee.name} ({employee.employee_id})")
        print(f"Role: {employee.role}, Team: {employee.team}")
        print()
        
        # 1. Add sample bugs assigned to Abhijai
        print("1. Adding sample bugs...")
        sample_bugs = [
            {
                "bug_id": 1001,
                "ticket_id": 12345,
                "subject": "Login button not responding on mobile",
                "status": "Closed",
                "severity": "Major",
                "priority": "High",
                "assignee": employee.name,
                "author": "QA Team",
                "created_on": datetime.now() - timedelta(days=15),
                "updated_on": datetime.now() - timedelta(days=5),
                "module": "Authentication",
                "environment": "Production"
            },
            {
                "bug_id": 1002,
                "ticket_id": 12345,
                "subject": "API timeout error on payment gateway",
                "status": "Open",
                "severity": "Critical",
                "priority": "Critical",
                "assignee": employee.name,
                "author": "QA Team",
                "created_on": datetime.now() - timedelta(days=3),
                "updated_on": datetime.now() - timedelta(days=1),
                "module": "Payment",
                "environment": "Staging"
            },
            {
                "bug_id": 1003,
                "ticket_id": 12346,
                "subject": "Data validation error in user registration",
                "status": "In Progress",
                "severity": "Minor",
                "priority": "Medium",
                "assignee": employee.name,
                "author": "QA Team",
                "created_on": datetime.now() - timedelta(days=7),
                "updated_on": datetime.now() - timedelta(days=2),
                "module": "User Management",
                "environment": "Development"
            },
            {
                "bug_id": 1004,
                "ticket_id": 12346,
                "subject": "Performance issue in dashboard loading",
                "status": "Closed",
                "severity": "Major",
                "priority": "High",
                "assignee": employee.name,
                "author": "QA Team",
                "created_on": datetime.now() - timedelta(days=20),
                "updated_on": datetime.now() - timedelta(days=10),
                "module": "Dashboard",
                "environment": "Production"
            },
            {
                "bug_id": 1005,
                "ticket_id": 12347,
                "subject": "Memory leak in report generation",
                "status": "Open",
                "severity": "Critical",
                "priority": "High",
                "assignee": employee.name,
                "author": "QA Team",
                "created_on": datetime.now() - timedelta(days=5),
                "updated_on": datetime.now() - timedelta(days=1),
                "module": "Reports",
                "environment": "Staging"
            }
        ]
        
        bugs_added = 0
        for bug_data in sample_bugs:
            existing = db.query(Bug).filter(Bug.bug_id == bug_data["bug_id"]).first()
            if not existing:
                bug = Bug(**bug_data)
                db.add(bug)
                bugs_added += 1
        print(f"   Added {bugs_added} new bugs")
        
        # 2. Add sample timesheet entries
        print("2. Adding sample timesheet entries...")
        timesheet_added = 0
        for i in range(20):  # Last 20 days
            entry_date = date.today() - timedelta(days=i)
            if entry_date.weekday() < 5:  # Only weekdays
                hours = random.uniform(6, 9)
                minutes = int(hours * 60)
                time_str = f"{int(hours)}:{int((hours % 1) * 60):02d}:00"
                
                existing = db.query(Timesheet).filter(
                    Timesheet.employee_name == employee.name,
                    Timesheet.date == entry_date
                ).first()
                
                if not existing:
                    timesheet = Timesheet(
                        employee_name=employee.name,
                        ticket_id=random.choice([12345, 12346, 12347]),
                        date=entry_date,
                        time_logged=time_str,
                        time_logged_minutes=minutes,
                        team=employee.team
                    )
                    db.add(timesheet)
                    timesheet_added += 1
        print(f"   Added {timesheet_added} timesheet entries")
        
        # 3. Add sample goals, strengths, and improvements
        print("3. Adding goals, strengths, and improvements...")
        goals_data = [
            {"goal_type": "strength", "title": "Strong problem-solving skills", "description": "Excellent at debugging complex issues"},
            {"goal_type": "strength", "title": "Good code quality", "description": "Writes clean, maintainable code"},
            {"goal_type": "improvement", "title": "Improve documentation", "description": "Need to document code better"},
            {"goal_type": "improvement", "title": "Increase test coverage", "description": "Aim for 80%+ test coverage"},
            {"goal_type": "goal", "title": "Complete payment gateway integration", "description": "Finish payment integration by end of quarter", "target_date": "2026-03-31", "progress": 65},
            {"goal_type": "goal", "title": "Learn React advanced patterns", "description": "Complete React course and implement in project", "target_date": "2026-02-28", "progress": 40}
        ]
        
        goals_added = 0
        for goal_data in goals_data:
            goal = EmployeeGoal(
                employee_id=employee.employee_id,
                goal_type=goal_data["goal_type"],
                title=goal_data["title"],
                description=goal_data.get("description", ""),
                target_date=datetime.strptime(goal_data["target_date"], "%Y-%m-%d").date() if goal_data.get("target_date") else None,
                progress=goal_data.get("progress", 0),
                created_by="Manager",
                created_on=datetime.now() - timedelta(days=30)
            )
            db.add(goal)
            goals_added += 1
        print(f"   Added {goals_added} goals/strengths/improvements")
        
        # 4. Add sample KPI ratings
        print("4. Adding sample KPI ratings...")
        # Get KPIs for SOFTWARE ENGINEER role
        kpis = db.query(KPI).filter(
            KPI.role == "SOFTWARE ENGINEER",
            KPI.is_active == True
        ).limit(5).all()
        
        if kpis:
            current_quarter = f"{datetime.now().year}-Q{(datetime.now().month - 1) // 3 + 1}"
            kpi_ratings_added = 0
            
            for kpi in kpis:
                existing_rating = db.query(KPIRating).filter(
                    KPIRating.employee_id == employee.employee_id,
                    KPIRating.kpi_id == kpi.id,
                    KPIRating.quarter == current_quarter
                ).first()
                
                if not existing_rating:
                    # Generate sample performance score (60-95)
                    performance_score = random.uniform(60, 95)
                    manager_rating = random.uniform(3.5, 5.0)
                    
                    rating = KPIRating(
                        employee_id=employee.employee_id,
                        kpi_id=kpi.id,
                        quarter=current_quarter,
                        year=datetime.now().year,
                        quarter_number=(datetime.now().month - 1) // 3 + 1,
                        performance_score=performance_score,
                        performance_percentage=performance_score,
                        manager_rating=manager_rating,
                        manager_comments=f"Good performance on {kpi.kpi_name.lower()}. Keep up the good work!",
                        final_score=manager_rating,
                        rated_by="DEEPAK JOSE",
                        rated_on=datetime.now() - timedelta(days=5)
                    )
                    db.add(rating)
                    kpi_ratings_added += 1
            print(f"   Added {kpi_ratings_added} KPI ratings for {current_quarter}")
        else:
            print("   No KPIs found for SOFTWARE ENGINEER role")
        
        # 5. Add sample performance review
        print("5. Adding sample performance review...")
        existing_review = db.query(EmployeeReview).filter(
            EmployeeReview.employee_id == employee.employee_id,
            EmployeeReview.review_period == str(datetime.now().year - 1)
        ).first()
        
        if not existing_review:
            review = EmployeeReview(
                employee_id=employee.employee_id,
                review_period=str(datetime.now().year - 1),
                review_date=date(datetime.now().year - 1, 12, 15),
                technical_rating=4,
                productivity_rating=4,
                quality_rating=5,
                communication_rating=4,
                overall_rating=4.25,
                strengths_summary="• Strong technical skills\n• Good problem-solving ability\n• Reliable team member",
                improvements_summary="• Can improve documentation\n• Should focus more on test coverage",
                manager_comments="Abhijai has shown consistent performance throughout the year. Great technical skills and always delivers on time.",
                recommendation="retain",
                salary_hike_percent=12.5,
                reviewed_by="DEEPAK JOSE",
                rag_score=75.0,
                rag_status="GREEN",
                created_on=datetime.now() - timedelta(days=30)
            )
            db.add(review)
            print("   Added performance review for last year")
        else:
            print("   Performance review already exists")
        
        # 6. Add sample ticket tracking (skip if model structure is different)
        print("6. Skipping ticket tracking (model structure may vary)")
        tickets_added = 0
        
        db.commit()
        
        print("\n" + "="*80)
        print("SAMPLE DATA ADDED SUCCESSFULLY!")
        print("="*80)
        print(f"\nEmployee: {employee.name} ({employee.employee_id})")
        print(f"View profile at: http://localhost:3000/employees/{employee.employee_id}")
        print("\nData added:")
        print(f"  - {bugs_added} bugs")
        print(f"  - {timesheet_added} timesheet entries")
        print(f"  - {goals_added} goals/strengths/improvements")
        print(f"  - {kpi_ratings_added} KPI ratings")
        print(f"  - 1 performance review")
        print(f"  - {tickets_added} ticket tracking entries")
        
    except Exception as e:
        db.rollback()
        import traceback
        print(f"ERROR: {str(e)}")
        print(traceback.format_exc())
        raise
    finally:
        db.close()


if __name__ == "__main__":
    print("="*80)
    print("ADDING SAMPLE DATA FOR ABHIJAI K P (TV0539)")
    print("="*80)
    print()
    try:
        add_sample_data()
        print("\n[SUCCESS] Sample data added successfully!")
    except Exception as e:
        print(f"\n[ERROR] Failed: {e}")
