"""Test profile access from different roles"""
import requests

BASE_URL = 'http://localhost:8000'

def test_profile_access(login_email, login_password, target_employee_id):
    print(f'\n{"="*60}')
    print(f'Testing: {login_email} accessing profile {target_employee_id}')
    print(f'{"="*60}')
    
    # Login
    res = requests.post(f'{BASE_URL}/auth/login', json={'email': login_email, 'password': login_password})
    if res.status_code != 200:
        print(f'  Login failed: {res.status_code}')
        return
    
    data = res.json()
    token = data['access_token']
    role = data['user'].get('role')
    own_emp_id = data['user'].get('employee_id')
    headers = {'Authorization': f'Bearer {token}'}
    
    print(f'  Logged in as: {role} (employee_id: {own_emp_id})')
    
    # Try to access profile
    profile_res = requests.get(f'{BASE_URL}/employees/{target_employee_id}', headers=headers)
    print(f'  Profile access status: {profile_res.status_code}')
    
    if profile_res.status_code == 200:
        profile_data = profile_res.json()
        print(f'  Profile name: {profile_data.get("name")}')
        print(f'  Can edit: {profile_data.get("_permissions", {}).get("can_edit")}')
    elif profile_res.status_code == 403:
        error = profile_res.json().get('detail', 'Access denied')
        print(f'  Access denied: {error}')
    else:
        print(f'  Error: {profile_res.text}')

# Test as ADMIN
test_profile_access('vishnu.vs@techversantinfotech.com', 'admin123', 'TV0871')

# Test as MANAGER_DEV
test_profile_access('deepak.jose@techversantinfotech.com', 'TV0032', 'TV0871')

# Test as LEAD_QA - accessing a random QA employee
test_profile_access('aravind@techversantinfo.com', 'TV0419', 'TV0871')

# Test as EMPLOYEE - accessing another employee
test_profile_access('binoy.dominic@techversantinfotech.com', 'TV0154', 'TV0871')

print('\n' + '='*60)
print('TESTS COMPLETE')
print('='*60)
