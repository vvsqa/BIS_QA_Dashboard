"""Check QA planning employee_id format"""
import requests

BASE_URL = 'http://localhost:8000'

# Login as manager
res = requests.post(f'{BASE_URL}/auth/login', json={'email': 'vishnu.vs@techversantinfotech.com', 'password': 'admin123'})
token = res.json()['access_token']
headers = {'Authorization': f'Bearer {token}'}

# Get QA planning data - need week_start_str
from datetime import datetime, timedelta
today = datetime.now()
# Get Monday of current week
monday = today - timedelta(days=today.weekday())
week_start = monday.strftime('%Y-%m-%d')
print(f'Fetching QA planning for week: {week_start}')

qa_res = requests.get(f'{BASE_URL}/qa-planning/week/{week_start}', headers=headers)
if qa_res.status_code == 200:
    data = qa_res.json()
    emps = data.get('employees', [])[:5]
    print('Sample employees from QA Planning:')
    for emp in emps:
        emp_id = emp.get('employee_id')
        name = emp.get('employee_name')
        print(f'  - employee_id: "{emp_id}" (type: {type(emp_id).__name__}), name: {name}')
        
    # Try to access one of these profiles
    if emps:
        test_emp_id = emps[0].get('employee_id')
        print(f'\nTesting profile access for: {test_emp_id}')
        profile_res = requests.get(f'{BASE_URL}/employees/{test_emp_id}', headers=headers)
        print(f'  Status: {profile_res.status_code}')
        if profile_res.status_code == 200:
            profile_data = profile_res.json()
            print(f'  Name: {profile_data.get("name")}')
        else:
            print(f'  Error: {profile_res.text}')
else:
    print(f'Error: {qa_res.status_code}')
    print(qa_res.text)
