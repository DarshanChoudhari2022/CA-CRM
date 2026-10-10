import { redirect } from "next/navigation";
import { PageHead } from "@/components/page-head";
import { StatusPill } from "@/components/status-pill";
import { requireIdentity } from "@/modules/identity/session";
import { rpc } from "@/modules/portal/queries";
import { AccountButton } from "./account-button";
import { EmployeeForm } from "./employee-form";

type Employee = {
  id: string;
  code: string;
  name: string;
  email: string;
  department: string;
  branch: string;
  manager: string | null;
  status: string;
  accountLinked: boolean;
};

export default async function EmployeesPage() {
  const identity = await requireIdentity();
  if (!["admin", "partner"].includes(identity.role)) redirect("/dashboard");
  const [employees, options] = await Promise.all([
    rpc<Employee[]>("employee_directory"),
    rpc<{
      branches: Array<{ id: string; name: string }>;
      policies: Array<{ id: string; name: string }>;
      managers: Array<{ id: string; name: string }>;
    }>("employee_form_options"),
  ]);
  return (
    <>
      <PageHead eyebrow="People" title="Employee directory" description="Manage your team and their access." />
      <section className="card">
        <div className="section-title">
          <h2>{employees.length} employees</h2>
          <div className="filters">
            <input type="search" placeholder="Search employees" aria-label="Search employees" />
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Employee</th>
                <th>Code</th>
                <th>Department</th>
                <th>Branch</th>
                <th>Manager</th>
                <th>Status</th>
                <th>Account</th>
              </tr>
            </thead>
            <tbody>
              {employees.map((employee) => (
                <tr key={employee.id}>
                  <td>
                    <span className="avatar">
                      {employee.name
                        .split(" ")
                        .map((part) => part[0])
                        .slice(0, 2)
                        .join("")}
                    </span>
                    {employee.name}
                    <div className="stat-note" style={{ marginLeft: 43 }}>
                      {employee.email}
                    </div>
                  </td>
                  <td>{employee.code}</td>
                  <td>{employee.department}</td>
                  <td>{employee.branch}</td>
                  <td>{employee.manager ?? "—"}</td>
                  <td>
                    <StatusPill value={employee.status} />
                  </td>
                  <td>
                    <AccountButton employeeId={employee.id} accountLinked={employee.accountLinked} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!employees.length && <div className="empty">Add the first employee below.</div>}
        </div>
      </section>
      <EmployeeForm options={options} />
    </>
  );
}
