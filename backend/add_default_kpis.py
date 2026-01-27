"""
Add default KPIs for all roles in the system
This script creates comprehensive KPIs for each role
"""
from database import SessionLocal
from models import KPI

# Define KPIs for each role - Only 5 most relevant KPIs per role
ROLE_KPIS = {
    "SOFTWARE ENGINEER": [
        {"name": "Code Quality", "category": "Technical Excellence", "weight": 0.25, "description": "Code is clean, modular, readable, and follows team standards"},
        {"name": "Timely Delivery", "category": "Delivery", "weight": 0.25, "description": "Tasks delivered on or before deadlines"},
        {"name": "Bug Resolution Rate", "category": "Quality", "weight": 0.20, "description": "Percentage of assigned bugs resolved within SLA"},
        {"name": "Code Review Participation", "category": "Collaboration", "weight": 0.15, "description": "Active participation in code reviews"},
        {"name": "Test Coverage", "category": "Quality", "weight": 0.15, "description": "Unit test coverage for developed features"},
    ],
    "ASSOCIATE SOFTWARE ENGINEER": [
        {"name": "Code Quality", "category": "Technical Excellence", "weight": 0.25, "description": "Code follows basic standards and best practices"},
        {"name": "Task Completion", "category": "Delivery", "weight": 0.25, "description": "Completes assigned tasks within timelines"},
        {"name": "Learning Velocity", "category": "Self-Development", "weight": 0.20, "description": "Speed of learning new technologies and concepts"},
        {"name": "Code Review Feedback", "category": "Collaboration", "weight": 0.15, "description": "Ability to incorporate feedback from code reviews"},
        {"name": "Bug Resolution", "category": "Quality", "weight": 0.15, "description": "Resolves assigned bugs effectively"},
    ],
    "LEAD": [
        {"name": "Technical Leadership", "category": "Leadership", "weight": 0.25, "description": "Provides technical direction and guidance to team"},
        {"name": "Team Productivity", "category": "Delivery Management", "weight": 0.25, "description": "Team's overall productivity and velocity"},
        {"name": "Code Quality Oversight", "category": "Quality", "weight": 0.20, "description": "Ensures high code quality standards across team"},
        {"name": "Team Mentoring", "category": "Leadership", "weight": 0.15, "description": "Effective mentoring and development of team members"},
        {"name": "Sprint Planning & Estimation", "category": "Delivery Management", "weight": 0.15, "description": "Accurate sprint planning and estimation"},
    ],
    "QA ENGINEER": [
        {"name": "Test Case Design", "category": "Test Coverage", "weight": 0.25, "description": "Quality and coverage of test case design"},
        {"name": "Bug Detection Rate", "category": "Defect Management", "weight": 0.25, "description": "Number and quality of bugs identified"},
        {"name": "Test Execution", "category": "Test Coverage", "weight": 0.20, "description": "Thoroughness and accuracy of test execution"},
        {"name": "Bug Reporting Quality", "category": "Defect Management", "weight": 0.15, "description": "Quality of bug reports and documentation"},
        {"name": "Test Automation", "category": "Technical Excellence", "weight": 0.15, "description": "Contribution to test automation efforts"},
    ],
    "QA MANAGER": [
        {"name": "Test Strategy & Planning", "category": "Strategic Leadership", "weight": 0.25, "description": "Effective test strategy and planning"},
        {"name": "Team Productivity", "category": "Team Management", "weight": 0.25, "description": "QA team's overall productivity"},
        {"name": "Defect Detection Effectiveness", "category": "Quality Assurance", "weight": 0.20, "description": "Team's effectiveness in finding defects"},
        {"name": "Defect Leakage Rate", "category": "Quality Assurance", "weight": 0.15, "description": "Minimizing defects reaching production"},
        {"name": "Team Development", "category": "Team Management", "weight": 0.15, "description": "Development and mentoring of QA team"},
    ],
    "PROJECT MANAGER": [
        {"name": "Project Delivery", "category": "Delivery Excellence", "weight": 0.25, "description": "On-time project delivery"},
        {"name": "Scope Management", "category": "Project Management", "weight": 0.25, "description": "Effective scope definition and management"},
        {"name": "Stakeholder Management", "category": "Communication", "weight": 0.20, "description": "Effective stakeholder communication and management"},
        {"name": "Resource Planning", "category": "Project Management", "weight": 0.15, "description": "Optimal resource allocation and planning"},
        {"name": "Risk Management", "category": "Project Management", "weight": 0.15, "description": "Proactive risk identification and mitigation"},
    ],
    "DEPARTMENT HEAD": [
        {"name": "Business Growth", "category": "Strategic Leadership", "weight": 0.25, "description": "Drives business growth and revenue"},
        {"name": "Portfolio Management", "category": "Strategic Leadership", "weight": 0.25, "description": "Effective management of project portfolio"},
        {"name": "Team Development", "category": "Team Management", "weight": 0.20, "description": "Development and growth of department teams"},
        {"name": "Client Relationship", "category": "Client Success", "weight": 0.15, "description": "Strong client relationships and satisfaction"},
        {"name": "Strategic Planning", "category": "Strategic Leadership", "weight": 0.15, "description": "Long-term strategic planning and execution"},
    ],
    "SENIOR SOFTWARE ENGINEER": [
        {"name": "Code Quality", "category": "Technical Excellence", "weight": 0.25, "description": "High-quality, maintainable code"},
        {"name": "Technical Design", "category": "Technical Excellence", "weight": 0.25, "description": "Effective technical design and architecture"},
        {"name": "Timely Delivery", "category": "Delivery", "weight": 0.20, "description": "Consistent on-time delivery"},
        {"name": "Mentoring", "category": "Leadership", "weight": 0.15, "description": "Mentoring junior developers"},
        {"name": "Code Review Excellence", "category": "Quality", "weight": 0.15, "description": "Thorough and constructive code reviews"},
    ],
    # Additional roles from database
    "ASSOCIATE SOFTWARE ENGINEER TRAINEE": [
        {"name": "Learning Progress", "category": "Self-Development", "weight": 0.30, "description": "Progress in learning and skill development"},
        {"name": "Task Completion", "category": "Delivery", "weight": 0.25, "description": "Completes assigned training tasks within timelines"},
        {"name": "Code Quality Basics", "category": "Technical Excellence", "weight": 0.20, "description": "Follows basic coding standards and best practices"},
        {"name": "Mentorship Reception", "category": "Collaboration", "weight": 0.15, "description": "Receptiveness to guidance and mentorship"},
        {"name": "Communication", "category": "Collaboration", "weight": 0.10, "description": "Clear communication with team and mentors"},
    ],
    "SOFTWARE TEST ENGINEER": [
        {"name": "Test Case Design", "category": "Test Coverage", "weight": 0.25, "description": "Quality and coverage of test case design"},
        {"name": "Bug Detection Rate", "category": "Defect Management", "weight": 0.25, "description": "Number and quality of bugs identified"},
        {"name": "Test Execution", "category": "Test Coverage", "weight": 0.20, "description": "Thoroughness and accuracy of test execution"},
        {"name": "Bug Reporting Quality", "category": "Defect Management", "weight": 0.15, "description": "Quality of bug reports and documentation"},
        {"name": "Test Automation", "category": "Technical Excellence", "weight": 0.15, "description": "Contribution to test automation efforts"},
    ],
    "SENIOR SOFTWARE TEST ENGINEER": [
        {"name": "Test Strategy & Design", "category": "Test Coverage", "weight": 0.25, "description": "Advanced test strategy and comprehensive test design"},
        {"name": "Bug Detection Effectiveness", "category": "Defect Management", "weight": 0.25, "description": "High-quality bug identification and analysis"},
        {"name": "Test Automation Leadership", "category": "Technical Excellence", "weight": 0.20, "description": "Leads test automation initiatives"},
        {"name": "Mentoring QA Team", "category": "Leadership", "weight": 0.15, "description": "Mentoring and developing junior QA engineers"},
        {"name": "Process Improvement", "category": "Leadership", "weight": 0.15, "description": "Drives QA process improvements"},
    ],
    "ASSOCIATE SOFTWARE TEST ENGINEER TRAINEE": [
        {"name": "Learning Progress", "category": "Self-Development", "weight": 0.30, "description": "Progress in learning QA practices and tools"},
        {"name": "Test Execution", "category": "Test Coverage", "weight": 0.25, "description": "Ability to execute test cases accurately"},
        {"name": "Bug Reporting", "category": "Defect Management", "weight": 0.20, "description": "Quality of bug reports and documentation"},
        {"name": "Mentorship Reception", "category": "Collaboration", "weight": 0.15, "description": "Receptiveness to guidance from senior QA"},
        {"name": "Communication", "category": "Collaboration", "weight": 0.10, "description": "Clear communication with dev team and mentors"},
    ],
    "TEAM LEAD": [
        {"name": "Technical Leadership", "category": "Leadership", "weight": 0.25, "description": "Provides technical direction and guidance to team"},
        {"name": "Team Productivity", "category": "Delivery Management", "weight": 0.25, "description": "Team's overall productivity and velocity"},
        {"name": "Code Quality Oversight", "category": "Quality", "weight": 0.20, "description": "Ensures high code quality standards across team"},
        {"name": "Team Mentoring", "category": "Leadership", "weight": 0.15, "description": "Effective mentoring and development of team members"},
        {"name": "Sprint Planning & Estimation", "category": "Delivery Management", "weight": 0.15, "description": "Accurate sprint planning and estimation"},
    ],
    "SENIOR TEAM LEAD": [
        {"name": "Strategic Technical Leadership", "category": "Leadership", "weight": 0.25, "description": "Provides strategic technical direction and vision"},
        {"name": "Team Performance", "category": "Delivery Management", "weight": 0.25, "description": "Overall team performance and delivery excellence"},
        {"name": "Architecture & Design", "category": "Technical Excellence", "weight": 0.20, "description": "System architecture and design decisions"},
        {"name": "Team Development", "category": "Leadership", "weight": 0.15, "description": "Development and growth of entire team"},
        {"name": "Stakeholder Management", "category": "Communication", "weight": 0.15, "description": "Effective communication with stakeholders"},
    ],
    "ASSOCIATE LEAD": [
        {"name": "Technical Leadership", "category": "Leadership", "weight": 0.25, "description": "Provides technical direction and guidance"},
        {"name": "Team Productivity", "category": "Delivery Management", "weight": 0.25, "description": "Team's productivity and velocity"},
        {"name": "Code Quality Oversight", "category": "Quality", "weight": 0.20, "description": "Ensures code quality standards"},
        {"name": "Team Mentoring", "category": "Leadership", "weight": 0.15, "description": "Mentoring team members"},
        {"name": "Sprint Planning", "category": "Delivery Management", "weight": 0.15, "description": "Sprint planning and estimation"},
    ],
    "ASSOCIATE LEAD - QA": [
        {"name": "Test Strategy & Planning", "category": "Strategic Leadership", "weight": 0.25, "description": "Effective test strategy and planning"},
        {"name": "Team Productivity", "category": "Team Management", "weight": 0.25, "description": "QA team's overall productivity"},
        {"name": "Defect Detection Effectiveness", "category": "Quality Assurance", "weight": 0.20, "description": "Team's effectiveness in finding defects"},
        {"name": "Team Development", "category": "Team Management", "weight": 0.15, "description": "Development and mentoring of QA team"},
        {"name": "Process Improvement", "category": "Strategic Leadership", "weight": 0.15, "description": "Drives QA process improvements"},
    ],
    "TECHNICAL ACCOUNTS MANAGER": [
        {"name": "Client Relationship Management", "category": "Client Success", "weight": 0.25, "description": "Strong client relationships and satisfaction"},
        {"name": "Project Delivery", "category": "Delivery Excellence", "weight": 0.25, "description": "On-time project delivery"},
        {"name": "Technical Solution Design", "category": "Technical Excellence", "weight": 0.20, "description": "Effective technical solution design for clients"},
        {"name": "Stakeholder Communication", "category": "Communication", "weight": 0.15, "description": "Effective communication with clients and stakeholders"},
        {"name": "Account Growth", "category": "Business Growth", "weight": 0.15, "description": "Account expansion and growth"},
    ],
    "CONSULTANT - BIS": [
        {"name": "Client Delivery", "category": "Delivery Excellence", "weight": 0.25, "description": "On-time delivery of client requirements"},
        {"name": "Client Satisfaction", "category": "Client Success", "weight": 0.25, "description": "Client satisfaction and relationship management"},
        {"name": "Technical Expertise", "category": "Technical Excellence", "weight": 0.20, "description": "Demonstrates strong technical expertise"},
        {"name": "Communication", "category": "Communication", "weight": 0.15, "description": "Effective communication with client stakeholders"},
        {"name": "Problem Solving", "category": "Technical Excellence", "weight": 0.15, "description": "Effective problem-solving for client challenges"},
    ],
}

def add_default_kpis():
    """Add default KPIs for all roles"""
    db = SessionLocal()
    try:
        total_added = 0
        total_updated = 0
        
        for role, kpis in ROLE_KPIS.items():
            # Determine team from role
            role_upper = role.upper()
            if 'QA' in role_upper or 'TEST ENGINEER' in role_upper or 'TEST' in role_upper:
                team = 'QA'
            elif 'SOFTWARE ENGINEER' in role_upper or 'LEAD' in role_upper or 'SENIOR' in role_upper or 'ASSOCIATE' in role_upper:
                team = 'DEVELOPMENT'
            elif 'MANAGER' in role_upper or 'CONSULTANT' in role_upper:
                team = None  # Cross-functional or client-facing
            else:
                team = 'DEVELOPMENT'  # Default to DEVELOPMENT
            
            print(f"\nProcessing role: {role} (Team: {team})")
            
            for kpi_data in kpis:
                # Generate KPI code
                kpi_code_base = kpi_data['name'].upper().replace(' ', '_').replace('&', 'AND').replace('/', '_')[:65]
                kpi_code = f"{role.replace(' ', '_')[:30]}_{kpi_code_base}"[:100]
                
                # Check if exists
                existing = db.query(KPI).filter(KPI.kpi_code == kpi_code).first()
                
                if existing:
                    # Update
                    existing.kpi_name = kpi_data['name']
                    existing.description = kpi_data['description']
                    existing.role = role
                    existing.team = team
                    existing.category = kpi_data['category']
                    existing.weight = kpi_data['weight']
                    existing.is_active = True
                    total_updated += 1
                    print(f"  Updated: {kpi_data['name']}")
                else:
                    # Create new
                    new_kpi = KPI(
                        kpi_code=kpi_code,
                        kpi_name=kpi_data['name'],
                        description=kpi_data['description'],
                        role=role,
                        team=team,
                        category=kpi_data['category'],
                        weight=kpi_data['weight'],
                        is_active=True
                    )
                    db.add(new_kpi)
                    total_added += 1
                    print(f"  Added: {kpi_data['name']}")
        
        db.commit()
        
        print("\n" + "="*80)
        print("SUMMARY")
        print("="*80)
        print(f"Total KPIs added: {total_added}")
        print(f"Total KPIs updated: {total_updated}")
        print(f"Total processed: {total_added + total_updated}")
        print(f"Roles processed: {len(ROLE_KPIS)}")
        
        return {
            "added": total_added,
            "updated": total_updated,
            "total": total_added + total_updated
        }
        
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
    print("ADDING DEFAULT KPIs FOR ALL ROLES")
    print("="*80)
    try:
        result = add_default_kpis()
        print("\n[SUCCESS] Default KPIs added successfully!")
    except Exception as e:
        print(f"\n[ERROR] Failed: {e}")
