# Administrator-only CA CRM

Employees use Attendance. The CA CRM launcher, navigation, pages, exports, server actions and database records are restricted to administrators. Assigning a client or a reporting manager does not grant CRM access.

Changing an administrator's role to Employee removes their CRM access on subsequent requests, including existing sessions and direct URLs. The public CRM login screen remains available, but rejects employee credentials and directs employees to Attendance.

Deploy both the application and `20261029090000_admin_only_crm.sql`. Apply `20261016140000_employee_manager_controls.sql` if missing; it supplies the reporting-manager function and directory fields. The migration runner skips recorded migrations.

Verification includes employee and legacy-manager access denial, administrator access, tenant isolation, direct exports, AI workpapers, document storage and receipt RPCs. Database checks use synthetic fixtures in transactions that roll back.
