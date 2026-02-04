"""Test authentication flows for different roles"""
import requests

BASE_URL = 'http://localhost:8000'

def test_login(email, password, expected_role):
    print(f'\n{"="*50}')
    print(f'Testing Login: {email}')
    print(f'Expected Role: {expected_role}')
    print(f'{"="*50}')
    
    try:
        # Login
        res = requests.post(f'{BASE_URL}/auth/login', json={'email': email, 'password': password})
        if res.status_code == 200:
            data = res.json()
            token = data['access_token']
            user = data.get('user', {})
            print(f'  [OK] Login successful')
            print(f'  Role: {user.get("role")}')
            print(f'  Password Changed: {user.get("password_changed_at")}')
            
            # Get /auth/me
            headers = {'Authorization': f'Bearer {token}'}
            me_res = requests.get(f'{BASE_URL}/auth/me', headers=headers)
            if me_res.status_code == 200:
                me_data = me_res.json()
                print(f'  Name: {me_data.get("name")}')
                print(f'  Employee ID: {me_data.get("employee_id")}')
                print(f'  Password Changed At: {me_data.get("password_changed_at")}')
                
                perms = me_data.get('permissions', {})
                print(f'\n  Permissions:')
                for key, val in perms.items():
                    print(f'    - {key}: {val}')
                
            # Test accessing own profile
            emp_id = user.get('employee_id')
            if emp_id:
                profile_res = requests.get(f'{BASE_URL}/employees/{emp_id}', headers=headers)
                print(f'\n  Own Profile Access: {profile_res.status_code}')
                if profile_res.status_code == 200:
                    profile_data = profile_res.json()
                    print(f'    - Name: {profile_data.get("name")}')
                    print(f'    - Can Edit: {profile_data.get("_permissions", {}).get("can_edit")}')
                    print(f'    - Access Role: {profile_data.get("access_role")}')
            
            # Test accessing another employee's profile (TV0154 - Binoy)
            if emp_id != 'TV0154':
                other_res = requests.get(f'{BASE_URL}/employees/TV0154', headers=headers)
                print(f'\n  Other Profile Access (TV0154): {other_res.status_code}')
                if other_res.status_code == 200:
                    print(f'    - Access granted')
                elif other_res.status_code == 403:
                    print(f'    - Access denied (as expected for non-manager)')
            
            return token
        else:
            print(f'  [FAIL] Status: {res.status_code}')
            try:
                print(f'  Error: {res.json().get("detail")}')
            except:
                print(f'  Error: {res.text}')
            return None
    except Exception as e:
        print(f'  [ERROR] {e}')
        return None

if __name__ == '__main__':
    print('\n' + '='*60)
    print('AUTHENTICATION FLOW TESTS')
    print('='*60)
    
    # Test Admin (using admin config email)
    test_login('vishnu.vs@techversantinfotech.com', 'admin123', 'ADMIN')
    
    # Test Manager (DEV) - default password is employee_id
    test_login('deepak.jose@techversantinfotech.com', 'TV0032', 'MANAGER_DEV')
    
    # Test Lead (QA)
    test_login('aravind@techversantinfo.com', 'TV0419', 'LEAD_QA')
    
    # Test Employee
    test_login('binoy.dominic@techversantinfotech.com', 'TV0154', 'EMPLOYEE')
    
    print('\n' + '='*60)
    print('TESTS COMPLETE')
    print('='*60)
