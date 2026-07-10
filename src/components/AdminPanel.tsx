import React, { useState, useEffect } from "react";
import { Plus, Users, FolderKanban, ShieldCheck, UserCheck, AlertCircle, Sparkles, Trash2, Mail, Phone, Pencil, X, Check, Building2, History, Search } from "lucide-react";
import { Employee, Project, AuditLog } from "../types";
import { addEmployee, createProject, deleteEmployee, deleteProject, updateEmployee, updateProject, subscribeAuditLogs } from "../lib/firestoreService";
import { motion, AnimatePresence } from "motion/react";

interface AdminPanelProps {
  currentUser: Employee;
  employees: Employee[];
  projects: Project[];
  mode?: 'employees' | 'projects' | 'logs';
}

export default function AdminPanel({ currentUser, employees, projects, mode }: AdminPanelProps) {
  // Admin Panel sub-tab: 'employees' | 'projects' | 'logs'
  const [adminSubTab, setAdminSubTab] = useState<'employees' | 'projects' | 'logs'>(mode || 'employees');

  // Sync state with mode prop if passed
  useEffect(() => {
    if (mode) {
      setAdminSubTab(mode);
    }
  }, [mode]);

  // Logs state
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [logsFilterProjectId, setLogsFilterProjectId] = useState<string>("all");

  // Subscribe to audit logs
  useEffect(() => {
    if (adminSubTab === 'logs') {
      const unsubscribe = subscribeAuditLogs((updatedLogs) => {
        setAuditLogs(updatedLogs);
      });
      return () => unsubscribe();
    }
  }, [adminSubTab]);

  // Employee creation form state
  const [empName, setEmpName] = useState("");
  const [empEmail, setEmpEmail] = useState("");
  const [empPhone, setEmpPhone] = useState("");
  const [empDesignation, setEmpDesignation] = useState("");
  const [empPassword, setEmpPassword] = useState("");
  const [empError, setEmpError] = useState<string | null>(null);
  const [empSuccess, setEmpSuccess] = useState(false);
  const [empLoading, setEmpLoading] = useState(false);

  // Project creation form state
  const [projName, setProjName] = useState("");
  const [projDesc, setProjDesc] = useState("");
  const [selectedMembers, setSelectedMembers] = useState<string[]>([]);
  const [projError, setProjError] = useState<string | null>(null);
  const [projSuccess, setProjSuccess] = useState(false);
  const [projLoading, setProjLoading] = useState(false);

  // Employee editing modal state
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [editEmpName, setEditEmpName] = useState("");
  const [editEmpEmail, setEditEmpEmail] = useState("");
  const [editEmpDesignation, setEditEmpDesignation] = useState("");
  const [editEmpRole, setEditEmpRole] = useState<'admin' | 'employee'>('employee');
  const [editEmpPassword, setEditEmpPassword] = useState("");
  const [editEmpLoading, setEditEmpLoading] = useState(false);
  const [editEmpError, setEditEmpError] = useState<string | null>(null);

  // Project editing modal state
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [editProjName, setEditProjName] = useState("");
  const [editProjDesc, setEditProjDesc] = useState("");
  const [editSelectedMembers, setEditSelectedMembers] = useState<string[]>([]);
  const [editProjLoading, setEditProjLoading] = useState(false);
  const [editProjError, setEditProjError] = useState<string | null>(null);

  // General operations state
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Filter out the admin themselves from list of employees to assign
  const otherEmployees = employees.filter(e => e.role !== "admin" && (e.email || "").toLowerCase().trim() !== "innovalleyservices@gmail.com");

  const handleDeleteEmployee = async (email: string) => {
    const userKey = window.prompt("To confirm deletion, please enter the administrator secret key:");
    if (userKey !== "Mbmn@B!#!951") {
      alert("Invalid secret key. Deletion aborted.");
      return;
    }
    if (window.confirm("Are you sure you want to remove this employee? They will lose workspace access.")) {
      try {
        setDeleteError(null);
        const res = await deleteEmployee(email);
        if (res.error) {
          setDeleteError(res.error);
        }
      } catch (err: any) {
        setDeleteError(err.message || "Failed to delete employee.");
      }
    }
  };

  const handleDeleteProject = async (id: string) => {
    const userKey = window.prompt("To confirm deletion, please enter the administrator secret key:");
    if (userKey !== "Mbmn@B!#!951") {
      alert("Invalid secret key. Deletion aborted.");
      return;
    }
    if (window.confirm("Are you sure you want to delete this project workspace? This will permanently delete the project and all of its tasks.")) {
      try {
        setDeleteError(null);
        const res = await deleteProject(id);
        if (res.error) {
          setDeleteError(res.error);
        }
      } catch (err: any) {
        setDeleteError(err.message || "Failed to delete project.");
      }
    }
  };

  const handleAddEmployee = async (e: React.FormEvent) => {
    e.preventDefault();
    setEmpError(null);
    setEmpSuccess(false);
    setEmpLoading(true);

    const emailNormalized = empEmail.trim().toLowerCase();
    if (!emailNormalized || !emailNormalized.includes("@")) {
      setEmpError("Please enter a valid Gmail address.");
      setEmpLoading(false);
      return;
    }

    if (employees.some(emp => emp.email && emp.email.trim().toLowerCase() === emailNormalized)) {
      setEmpError("An employee with this Gmail address already exists.");
      setEmpLoading(false);
      return;
    }

    const normalizedPhone = empPhone ? empPhone.replace(/[^0-9]/g, "") : "";

    try {
      await addEmployee({
        name: empName,
        email: emailNormalized,
        phone: normalizedPhone,
        designation: empDesignation,
        password: empPassword || "123456"
      });

      setEmpName("");
      setEmpEmail("");
      setEmpPhone("");
      setEmpDesignation("");
      setEmpPassword("");
      setEmpSuccess(true);
      setTimeout(() => setEmpSuccess(false), 3000);
    } catch (err: any) {
      setEmpError(err.message || "Failed to add employee.");
    } finally {
      setEmpLoading(false);
    }
  };

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    setProjError(null);
    setProjSuccess(false);
    setProjLoading(true);

    if (!projName.trim()) {
      setProjError("Project name is required.");
      setProjLoading(false);
      return;
    }

    try {
      await createProject(
        projName.trim(),
        projDesc.trim(),
        currentUser.email || "",
        selectedMembers
      );

      setProjName("");
      setProjDesc("");
      setSelectedMembers([]);
      setProjSuccess(true);
      setTimeout(() => setProjSuccess(false), 3000);
    } catch (err: any) {
      setProjError(err.message || "Failed to create project.");
    } finally {
      setProjLoading(false);
    }
  };

  const handleEditEmployeeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingEmployee) return;
    setEditEmpLoading(true);
    setEditEmpError(null);

    try {
      const res = await updateEmployee(editingEmployee.email || editingEmployee.phone, {
        name: editEmpName,
        designation: editEmpDesignation,
        role: editEmpRole,
        password: editEmpPassword
      });
      if (res && res.error) {
        setEditEmpError(res.error);
      } else {
        setEditingEmployee(null);
      }
    } catch (err: any) {
      setEditEmpError(err.message || "Failed to update employee.");
    } finally {
      setEditEmpLoading(false);
    }
  };

  const handleEditProjectSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingProject) return;
    setEditProjLoading(true);
    setEditProjError(null);

    try {
      const res = await updateProject(editingProject.id!, {
        name: editProjName,
        description: editProjDesc,
        members: editSelectedMembers
      });
      if (res && res.error) {
        setEditProjError(res.error);
      } else {
        setEditingProject(null);
      }
    } catch (err: any) {
      setEditProjError(err.message || "Failed to update project.");
    } finally {
      setEditProjLoading(false);
    }
  };

  const toggleMemberSelection = (email: string) => {
    if (selectedMembers.includes(email)) {
      setSelectedMembers(prev => prev.filter(p => p !== email));
    } else {
      setSelectedMembers(prev => [...prev, email]);
    }
  };

  const toggleEditMemberSelection = (email: string) => {
    if (editSelectedMembers.includes(email)) {
      setEditSelectedMembers(prev => prev.filter(p => p !== email));
    } else {
      setEditSelectedMembers(prev => [...prev, email]);
    }
  };

  return (
    <div className="space-y-6 font-sans pb-12" id="admin-panel-container">
      {/* Tailored Admin Quick Stats Banner */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {adminSubTab === 'employees' ? (
          <>
            <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-100 hover:border-indigo-200 transition-all flex items-center justify-between group">
              <div>
                <span className="text-slate-400 text-[10px] font-bold uppercase tracking-widest block mb-0.5">Total Registered Team</span>
                <span className="text-2xl font-extrabold text-slate-800 font-display">{employees.length}</span>
              </div>
              <div className="p-2.5 bg-indigo-50 text-indigo-600 rounded-lg transition-colors group-hover:bg-indigo-100">
                <Users className="w-5 h-5" />
              </div>
            </div>
            <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-100 hover:border-indigo-200 transition-all flex items-center justify-between group">
              <div>
                <span className="text-slate-400 text-[10px] font-bold uppercase tracking-widest block mb-0.5">Administrative Access</span>
                <span className="text-2xl font-extrabold text-slate-800 font-display">
                  {employees.filter(e => e.role === 'admin').length}
                </span>
              </div>
              <div className="p-2.5 bg-indigo-50 text-indigo-600 rounded-lg transition-colors group-hover:bg-indigo-100">
                <ShieldCheck className="w-5 h-5" />
              </div>
            </div>
            <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-100 hover:border-indigo-200 transition-all flex items-center justify-between group">
              <div>
                <span className="text-slate-400 text-[10px] font-bold uppercase tracking-widest block mb-0.5">Access Verification</span>
                <span className="text-sm font-extrabold text-indigo-600 block">OTP Controlled</span>
                <span className="text-[10px] text-slate-400 font-medium block">Secure Phone Auth</span>
              </div>
              <div className="p-2.5 bg-indigo-50 text-indigo-600 rounded-lg transition-colors group-hover:bg-indigo-100">
                <UserCheck className="w-5 h-5" />
              </div>
            </div>
          </>
        ) : adminSubTab === 'projects' ? (
          <>
            <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-100 hover:border-indigo-200 transition-all flex items-center justify-between group">
              <div>
                <span className="text-slate-400 text-[10px] font-bold uppercase tracking-widest block mb-0.5">Core Project Boards</span>
                <span className="text-2xl font-extrabold text-slate-800 font-display">{projects.length}</span>
              </div>
              <div className="p-2.5 bg-indigo-50 text-indigo-600 rounded-lg transition-colors group-hover:bg-indigo-100">
                <FolderKanban className="w-5 h-5" />
              </div>
            </div>
            <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-100 hover:border-indigo-200 transition-all flex items-center justify-between group">
              <div>
                <span className="text-slate-400 text-[10px] font-bold uppercase tracking-widest block mb-0.5">Total Members Joined</span>
                <span className="text-2xl font-extrabold text-slate-800 font-display">
                  {projects.reduce((acc, p) => acc + (p.members?.length || 0), 0)}
                </span>
              </div>
              <div className="p-2.5 bg-indigo-50 text-indigo-600 rounded-lg transition-colors group-hover:bg-indigo-100">
                <Users className="w-5 h-5" />
              </div>
            </div>
            <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-100 hover:border-indigo-200 transition-all flex items-center justify-between group">
              <div>
                <span className="text-slate-400 text-[10px] font-bold uppercase tracking-widest block mb-0.5">Workspace Sync</span>
                <span className="text-sm font-extrabold text-amber-600 block">Supabase Real-time Disabled</span>
                <span className="text-[10px] text-slate-500 font-bold block">Data Stored & Persistent</span>
              </div>
              <div className="p-2.5 bg-indigo-50 text-indigo-600 rounded-lg transition-colors group-hover:bg-indigo-100">
                <Building2 className="w-5 h-5" />
              </div>
            </div>
          </>
        ) : null}
      </div>

      {/* Dynamic Sub-tab Selector */}
      {!mode && (
        <div className="bg-slate-100 p-1.5 rounded-xl flex max-w-xl border border-slate-200/60" id="admin-subtabs">
          <button
            onClick={() => { setAdminSubTab('employees'); setDeleteError(null); }}
            className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-2 cursor-pointer ${
              adminSubTab === 'employees'
                ? 'bg-white text-indigo-700 shadow-sm border border-slate-200/10'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <Users className="w-4 h-4" />
            Employee Directory
          </button>
          <button
            onClick={() => { setAdminSubTab('projects'); setDeleteError(null); }}
            className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-2 cursor-pointer ${
              adminSubTab === 'projects'
                ? 'bg-white text-indigo-700 shadow-sm border border-slate-200/10'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <FolderKanban className="w-4 h-4" />
            Project Workspaces
          </button>
          <button
            onClick={() => { setAdminSubTab('logs'); setDeleteError(null); }}
            className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-2 cursor-pointer ${
              adminSubTab === 'logs'
                ? 'bg-white text-indigo-700 shadow-sm border border-slate-200/10'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <History className="w-4 h-4" />
            Project Logs
          </button>
        </div>
      )}

      {/* Delete/General error display */}
      {deleteError && (
        <div className="bg-red-50 text-red-700 p-3 rounded-xl flex items-start gap-2 text-sm border border-red-200">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <span>{deleteError}</span>
        </div>
      )}

      {/* Tab Specific Content panels */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {adminSubTab === 'employees' ? (
          <>
            {/* ADD EMPLOYEE COMPONENT */}
            <div className="lg:col-span-4 bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden h-fit">
              <div className="p-5 border-b border-slate-50 bg-slate-50/50 flex items-center gap-3">
                <div className="w-9 h-9 bg-indigo-50 text-indigo-600 rounded-lg flex items-center justify-center font-bold">
                  +
                </div>
                <div>
                  <h3 className="font-bold text-slate-800 text-sm font-display">Add New Employee</h3>
                  <p className="text-[10px] text-slate-400">Register employee details for Gmail login</p>
                </div>
              </div>

              <form onSubmit={handleAddEmployee} className="p-5 space-y-4">
                {empError && (
                  <div className="bg-red-50 text-red-700 p-3 rounded-xl flex items-start gap-2 text-xs border border-red-200">
                    <AlertCircle className="w-4.5 h-4.5 shrink-0" />
                    <span>{empError}</span>
                  </div>
                )}
                {empSuccess && (
                  <div className="bg-emerald-50 text-emerald-800 p-3 rounded-xl flex items-center gap-2 text-xs border border-emerald-200">
                    <UserCheck className="w-4.5 h-4.5 text-emerald-600 shrink-0" />
                    <span>Employee registered successfully! They can now log in via Password.</span>
                  </div>
                )}

                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">Full Name</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Murali Krishna"
                    value={empName}
                    onChange={(e) => setEmpName(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 text-xs font-medium placeholder-slate-400 text-slate-800"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">Email Address</label>
                  <input
                    type="email"
                    required
                    placeholder="e.g. employee@domain.com"
                    value={empEmail}
                    onChange={(e) => setEmpEmail(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 text-xs font-medium placeholder-slate-400 text-slate-800"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">Mobile Number (Optional)</label>
                  <input
                    type="tel"
                    placeholder="e.g. 9848884000"
                    value={empPhone}
                    onChange={(e) => setEmpPhone(e.target.value.replace(/[^0-9]/g, ""))}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 text-xs font-semibold placeholder-slate-400 font-mono text-slate-800"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">Designation</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Senior Frontend Developer"
                    value={empDesignation}
                    onChange={(e) => setEmpDesignation(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 text-xs font-medium placeholder-slate-400 text-slate-800"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">Login Password</label>
                  <input
                    type="text"
                    placeholder="Enter password (default: 123456)"
                    value={empPassword}
                    onChange={(e) => setEmpPassword(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 text-xs font-semibold placeholder-slate-400 text-slate-800"
                  />
                </div>

                <button
                  type="submit"
                  disabled={empLoading}
                  className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-lg text-xs transition-colors shadow-sm disabled:opacity-50 flex items-center justify-center gap-1.5"
                >
                  <Plus className="w-4 h-4" />
                  {empLoading ? "Registering..." : "Add & Register Employee"}
                </button>
              </form>
            </div>

            {/* MANAGE EMPLOYEES COMPONENT */}
            <div className="lg:col-span-8 bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden h-fit" id="manage-employees-card">
              <div className="p-5 border-b border-slate-50 bg-slate-50/50 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 bg-indigo-50 text-indigo-600 rounded-lg flex items-center justify-center font-bold">
                    <Users className="w-4.5 h-4.5" />
                  </div>
                  <div>
                    <h3 className="font-bold text-slate-800 text-sm font-display">Manage Team Employees</h3>
                    <p className="text-[10px] text-slate-400">View, edit, and revoke user credentials</p>
                  </div>
                </div>
                <span className="text-[10px] font-bold bg-slate-100 text-slate-500 px-2.5 py-1 rounded-lg border border-slate-200">
                  {employees.length} Registered
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50/50 border-b border-slate-100">
                      <th className="p-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider">Employee</th>
                      <th className="p-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider">Contact Info</th>
                      <th className="p-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider">Designation</th>
                      <th className="p-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider">Access Level</th>
                      <th className="p-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {employees.map((emp) => {
                      const isSystemAdmin = emp.email === "innovalleyservices@gmail.com";
                      const initials = emp.name ? emp.name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2) : "U";
                      return (
                        <tr key={emp.email || emp.phone} className="hover:bg-slate-50/40 transition-colors">
                          <td className="p-3">
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-full bg-slate-100 text-slate-600 font-bold text-[11px] flex items-center justify-center border border-slate-200">
                                {initials}
                              </div>
                              <div>
                                <div className="text-xs font-bold text-slate-800">{emp.name}</div>
                                <div className="text-[10px] text-slate-400 font-mono">ID: {emp.email}</div>
                              </div>
                            </div>
                          </td>
                          <td className="p-3">
                            <div className="space-y-0.5">
                              <div className="text-xs font-medium text-slate-600 flex items-center gap-1 max-w-[150px] truncate" title={emp.email}>
                                <Mail className="w-3 h-3 text-slate-400 shrink-0" />
                                {emp.email}
                              </div>
                              <div className="text-[10px] text-slate-500 font-mono flex items-center gap-1">
                                <Phone className="w-3 h-3 text-slate-400" />
                                {emp.phone || "Not provided"}
                              </div>
                            </div>
                          </td>
                          <td className="p-3">
                            <span className="text-[10px] font-semibold text-slate-700 bg-slate-100 px-2 py-0.5 rounded border border-slate-200/50">
                              {emp.designation || "Developer"}
                            </span>
                          </td>
                          <td className="p-3">
                            <span className={`text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${
                              emp.role === 'admin' || isSystemAdmin
                                ? 'bg-indigo-50 text-indigo-700 border border-indigo-200/60'
                                : 'bg-emerald-50 text-emerald-700 border border-emerald-200/60'
                            }`}>
                              {emp.role === 'admin' || isSystemAdmin ? 'Admin' : 'Employee'}
                            </span>
                          </td>
                          <td className="p-3 text-right">
                            {isSystemAdmin ? (
                              <span className="text-[10px] text-indigo-600 font-bold block pr-2 uppercase tracking-wide">Primary Admin</span>
                            ) : (
                              <div className="flex items-center justify-end gap-1.5">
                                <button
                                  onClick={() => {
                                    setEditingEmployee(emp);
                                    setEditEmpName(emp.name);
                                    setEditEmpEmail(emp.email);
                                    setEditEmpDesignation(emp.designation || "");
                                    setEditEmpRole(emp.role || "employee");
                                    setEditEmpPassword(emp.password || "");
                                    setEditEmpError(null);
                                  }}
                                  className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all"
                                  title="Edit employee"
                                >
                                  <Pencil className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  onClick={() => handleDeleteEmployee(emp.email)}
                                  className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
                                  title="Revoke access"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        ) : adminSubTab === 'projects' ? (
          <>
            {/* CREATE PROJECT COMPONENT */}
            <div className="lg:col-span-4 bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden h-fit">
              <div className="p-5 border-b border-slate-50 bg-slate-50/50 flex items-center gap-3">
                <div className="w-9 h-9 bg-indigo-50 text-indigo-600 rounded-lg flex items-center justify-center font-bold">
                  ✓
                </div>
                <div>
                  <h3 className="font-bold text-slate-800 text-sm font-display">Create New Project</h3>
                  <p className="text-[10px] text-slate-400">Initialize a workspace & admit team members</p>
                </div>
              </div>

              <form onSubmit={handleCreateProject} className="p-5 space-y-4">
                {projError && (
                  <div className="bg-red-50 text-red-700 p-3 rounded-xl flex items-start gap-2 text-xs border border-red-200">
                    <AlertCircle className="w-4.5 h-4.5 shrink-0" />
                    <span>{projError}</span>
                  </div>
                )}
                {projSuccess && (
                  <div className="bg-emerald-50 text-emerald-800 p-3 rounded-xl flex items-center gap-2 text-xs border border-emerald-200">
                    <Sparkles className="w-4.5 h-4.5 text-emerald-600 shrink-0" />
                    <span>Project created successfully! Members admitted.</span>
                  </div>
                )}

                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">Project Name</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Innovalley Core Platform"
                    value={projName}
                    onChange={(e) => setProjName(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 text-xs font-medium placeholder-slate-400 text-slate-800"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">Project Description</label>
                  <textarea
                    rows={3}
                    placeholder="Describe project targets, scopes..."
                    value={projDesc}
                    onChange={(e) => setProjDesc(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 text-xs font-medium placeholder-slate-400 text-slate-800"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-600 mb-1">
                    Admit Members into Project ({selectedMembers.length} selected)
                  </label>
                  <div className="mt-1 border border-slate-100 rounded-lg max-h-40 overflow-y-auto divide-y divide-slate-100 p-1 bg-slate-50">
                    {otherEmployees.length === 0 ? (
                      <p className="text-[10px] text-slate-400 p-3 text-center">No other employees added yet. Register employees first!</p>
                    ) : (
                      otherEmployees.map((emp) => {
                        const isSelected = selectedMembers.includes(emp.email || emp.phone);
                        return (
                          <div
                            key={emp.email || emp.phone}
                            onClick={() => toggleMemberSelection(emp.email || emp.phone)}
                            className={`flex items-center justify-between p-2.5 cursor-pointer rounded-lg transition-all ${
                              isSelected ? 'bg-indigo-50/60 text-indigo-950 font-bold border border-indigo-100' : 'hover:bg-slate-100 text-slate-600'
                            }`}
                          >
                            <div className="overflow-hidden mr-2">
                              <div className="text-[11px] font-bold truncate">{emp.name}</div>
                              <div className="text-[9px] text-slate-400 truncate">{emp.designation}</div>
                            </div>
                            <div className={`w-4 h-4 rounded-full border flex items-center justify-center transition-all ${
                              isSelected ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-slate-300'
                            }`}>
                              {isSelected && <span className="text-[9px]">✓</span>}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={projLoading}
                  className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-lg text-xs transition-colors shadow-sm disabled:opacity-50 flex items-center justify-center gap-1.5"
                >
                  <FolderKanban className="w-4 h-4" />
                  {projLoading ? "Creating..." : "Create Project Workspace"}
                </button>
              </form>
            </div>

            {/* MANAGE PROJECTS COMPONENT */}
            <div className="lg:col-span-8 bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden h-fit" id="manage-projects-card">
              <div className="p-5 border-b border-slate-50 bg-slate-50/50 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 bg-indigo-50 text-indigo-600 rounded-lg flex items-center justify-center font-bold">
                    <FolderKanban className="w-4.5 h-4.5" />
                  </div>
                  <div>
                    <h3 className="font-bold text-slate-800 text-sm font-display">Manage Active Project Workspaces</h3>
                    <p className="text-[10px] text-slate-400">Review project ownership and core memberships</p>
                  </div>
                </div>
                <span className="text-[10px] font-bold bg-slate-100 text-slate-500 px-2.5 py-1 rounded-lg border border-slate-200">
                  {projects.length} Workspaces
                </span>
              </div>

              {projects.length === 0 ? (
                <div className="p-10 text-center text-slate-400 text-xs">
                  No active project workspaces found. Use the form to initialize one!
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {projects.map((proj) => {
                    const membersCount = proj.members ? proj.members.length : 0;
                    const ownerEmployee = employees.find(e => e.email === proj.createdBy || e.phone === proj.createdBy);
                    return (
                      <div key={proj.id} className="p-5 hover:bg-slate-50/40 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <div className="space-y-1 max-w-lg overflow-hidden">
                          <h4 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                            {proj.name}
                            <span className="text-[9px] bg-slate-100 text-slate-400 font-mono px-1.5 py-0.5 rounded font-normal">
                              ID: {proj.id?.slice(0, 8) || "Local"}
                            </span>
                          </h4>
                          <p className="text-xs text-slate-500 leading-relaxed max-w-md">{proj.description || "No description provided."}</p>
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-1">
                            <span className="text-[10px] text-slate-400">
                              Owner: <span className="font-bold text-slate-600">{ownerEmployee ? ownerEmployee.name : "Innovalley Services (Admin)"}</span>
                            </span>
                            <span className="text-[10px] text-slate-400 flex items-center gap-1">
                              <Users className="w-3 h-3 text-slate-400" />
                              <span className="font-bold text-slate-600">{membersCount} admitted members</span>
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
                          <button
                            onClick={() => {
                              setEditingProject(proj);
                              setEditProjName(proj.name);
                              setEditProjDesc(proj.description || "");
                              setEditSelectedMembers(proj.members || []);
                              setEditProjError(null);
                            }}
                            className="flex items-center gap-1 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-lg text-xs transition-colors border border-slate-200/40"
                          >
                            <Pencil className="w-3 h-3" />
                            Edit
                          </button>
                          <button
                            onClick={() => handleDeleteProject(proj.id!)}
                            className="flex items-center gap-1 px-3 py-1.5 bg-red-50 hover:bg-red-100 text-red-700 font-bold rounded-lg text-xs transition-colors border border-red-100/40"
                          >
                            <Trash2 className="w-3 h-3" />
                            Delete
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        ) : (
          /* AUDIT LOGS TAB PANEL */
          <div className="col-span-12 space-y-6">
            <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
              <div className="p-5 border-b border-slate-100 bg-slate-50/50 flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-indigo-50 text-indigo-600 rounded-lg flex items-center justify-center">
                    <History className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-bold text-slate-800 text-sm font-display">System-wide Activity Audit Logs</h3>
                    <p className="text-[10px] text-slate-400">Track and filter team and task operations project-wise</p>
                  </div>
                </div>

                {/* Project-wise dropdown selector */}
                <div className="flex items-center gap-2">
                  <label className="text-xs font-bold text-slate-500 whitespace-nowrap">Filter Workspace:</label>
                  <select
                    value={logsFilterProjectId}
                    onChange={(e) => setLogsFilterProjectId(e.target.value)}
                    className="bg-white border border-slate-200 rounded-xl px-3 py-1.5 font-bold text-slate-700 text-xs focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="all">-- All Projects --</option>
                    {projects.map(p => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Logs List */}
              <div className="divide-y divide-slate-100 max-h-[600px] overflow-y-auto">
                {auditLogs.filter(log => logsFilterProjectId === "all" || log.projectId === logsFilterProjectId).length === 0 ? (
                  <div className="p-16 text-center">
                    <History className="w-10 h-10 mx-auto text-slate-300 mb-2 animate-pulse" />
                    <p className="text-sm font-semibold text-slate-500">No activity logs recorded yet.</p>
                    <p className="text-xs text-slate-400 mt-1">Actions like assigning tasks or changing task statuses will show up here.</p>
                  </div>
                ) : (
                  auditLogs
                    .filter(log => logsFilterProjectId === "all" || log.projectId === logsFilterProjectId)
                    .map((log) => {
                      const dateStr = new Date(log.timestamp).toLocaleString();
                      let actionColor = "bg-slate-100 text-slate-600";
                      if (log.action === "CREATE_TASK") actionColor = "bg-blue-100 text-blue-700";
                      else if (log.action === "UPDATE_TASK_STATUS") {
                        if (log.details.includes("completed")) {
                          actionColor = "bg-emerald-100 text-emerald-700";
                        } else {
                          actionColor = "bg-amber-100 text-amber-700";
                        }
                      } else if (log.action === "CREATE_PROJECT") actionColor = "bg-indigo-100 text-indigo-700";

                      return (
                        <div key={log.id} className="p-4 hover:bg-slate-50/30 transition-colors flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
                          <div className="space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className={`px-2 py-0.5 rounded text-[9px] font-extrabold uppercase tracking-wider ${actionColor}`}>
                                {log.action.replace(/_/g, " ")}
                              </span>
                              <span className="text-[10px] font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-lg border border-indigo-100">
                                {log.projectName}
                              </span>
                              <span className="text-[10px] text-slate-400 font-mono">
                                {dateStr}
                              </span>
                            </div>
                            <p className="text-xs font-semibold text-slate-700 leading-relaxed">
                              {log.details}
                            </p>
                          </div>

                          <div className="shrink-0 text-right">
                            <span className="text-[9px] font-bold text-slate-400 block uppercase tracking-wider">Operator</span>
                            <span className="text-xs font-bold text-slate-700 block">{log.operatorName}</span>
                            <span className="text-[9px] text-slate-400 font-mono block">{log.operatorPhone}</span>
                          </div>
                        </div>
                      );
                    })
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* EDIT EMPLOYEE MODAL */}
      <AnimatePresence>
        {editingEmployee && (
          <div className="fixed inset-0 z-50 overflow-y-auto" id="edit-employee-modal">
            <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center sm:block sm:p-0">
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setEditingEmployee(null)}
                className="fixed inset-0 transition-opacity bg-slate-900/60"
              />
              <span className="hidden sm:inline-block sm:align-middle sm:h-screen" aria-hidden="true">&#8203;</span>
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 15 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 15 }}
                className="inline-block w-full max-w-md p-6 my-8 overflow-hidden text-left align-middle transition-all transform bg-white shadow-2xl rounded-2xl border border-slate-100 sm:align-middle"
              >
                <div className="flex items-center justify-between pb-4 border-b border-slate-100 mb-4">
                  <div className="flex items-center gap-2">
                    <Pencil className="w-4 h-4 text-indigo-600" />
                    <h3 className="text-base font-extrabold text-slate-900 font-display">Edit Employee Details</h3>
                  </div>
                  <button
                    onClick={() => setEditingEmployee(null)}
                    className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-50"
                  >
                    <X className="w-4.5 h-4.5" />
                  </button>
                </div>

                <form onSubmit={handleEditEmployeeSubmit} className="space-y-4">
                  {editEmpError && (
                    <div className="bg-red-50 text-red-700 p-3 rounded-xl flex items-start gap-2 text-xs border border-red-200">
                      <AlertCircle className="w-4.5 h-4.5 shrink-0" />
                      <span>{editEmpError}</span>
                    </div>
                  )}

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">Employee Email ID (Non-editable)</label>
                    <input
                      type="text"
                      disabled
                      value={editingEmployee.email || editingEmployee.phone}
                      className="w-full px-3 py-2 border border-slate-200 bg-slate-50 text-slate-400 rounded-lg text-xs font-mono font-bold cursor-not-allowed"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">Full Name</label>
                    <input
                      type="text"
                      required
                      value={editEmpName}
                      onChange={(e) => setEditEmpName(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 text-xs font-medium text-slate-800"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">Email Address</label>
                    <input
                      type="email"
                      required
                      value={editEmpEmail}
                      onChange={(e) => setEditEmpEmail(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 text-xs font-medium text-slate-800"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">Designation</label>
                    <input
                      type="text"
                      required
                      value={editEmpDesignation}
                      onChange={(e) => setEditEmpDesignation(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 text-xs font-medium text-slate-800"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">Access / Permission Role</label>
                    <select
                      value={editEmpRole}
                      onChange={(e) => setEditEmpRole(e.target.value as 'admin' | 'employee')}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 text-xs font-semibold text-slate-700 bg-slate-50 cursor-pointer"
                    >
                      <option value="employee">Employee (Limited Board Access)</option>
                      <option value="admin">Administrator (Full Control)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">Change / Update Password</label>
                    <input
                      type="text"
                      required
                      placeholder="Enter new password"
                      value={editEmpPassword}
                      onChange={(e) => setEditEmpPassword(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 text-xs font-medium text-slate-800"
                    />
                  </div>

                  <div className="flex justify-end gap-2.5 pt-4 border-t border-slate-100 mt-5">
                    <button
                      type="button"
                      onClick={() => setEditingEmployee(null)}
                      className="px-4 py-2 border border-slate-200 rounded-lg text-slate-500 hover:bg-slate-50 text-xs font-semibold transition-all cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={editEmpLoading}
                      className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg shadow-md transition-all flex items-center gap-1.5 disabled:opacity-50"
                    >
                      {editEmpLoading ? "Saving..." : "Save Changes"}
                    </button>
                  </div>
                </form>
              </motion.div>
            </div>
          </div>
        )}
      </AnimatePresence>

      {/* EDIT PROJECT MODAL */}
      <AnimatePresence>
        {editingProject && (
          <div className="fixed inset-0 z-50 overflow-y-auto" id="edit-project-modal">
            <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center sm:block sm:p-0">
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setEditingProject(null)}
                className="fixed inset-0 transition-opacity bg-slate-900/60"
              />
              <span className="hidden sm:inline-block sm:align-middle sm:h-screen" aria-hidden="true">&#8203;</span>
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 15 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 15 }}
                className="inline-block w-full max-w-md p-6 my-8 overflow-hidden text-left align-middle transition-all transform bg-white shadow-2xl rounded-2xl border border-slate-100 sm:align-middle"
              >
                <div className="flex items-center justify-between pb-4 border-b border-slate-100 mb-4">
                  <div className="flex items-center gap-2">
                    <Pencil className="w-4 h-4 text-indigo-600" />
                    <h3 className="text-base font-extrabold text-slate-900 font-display">Edit Project Workspace</h3>
                  </div>
                  <button
                    onClick={() => setEditingProject(null)}
                    className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-50"
                  >
                    <X className="w-4.5 h-4.5" />
                  </button>
                </div>

                <form onSubmit={handleEditProjectSubmit} className="space-y-4">
                  {editProjError && (
                    <div className="bg-red-50 text-red-700 p-3 rounded-xl flex items-start gap-2 text-xs border border-red-200">
                      <AlertCircle className="w-4.5 h-4.5 shrink-0" />
                      <span>{editProjError}</span>
                    </div>
                  )}

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">Project Name</label>
                    <input
                      type="text"
                      required
                      value={editProjName}
                      onChange={(e) => setEditProjName(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 text-xs font-medium text-slate-800"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">Project Description</label>
                    <textarea
                      rows={3}
                      value={editProjDesc}
                      onChange={(e) => setEditProjDesc(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 text-xs font-medium text-slate-800"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 mb-1">
                      Admitted Members Workspace Checklist ({editSelectedMembers.length} selected)
                    </label>
                    <div className="mt-1 border border-slate-100 rounded-lg max-h-40 overflow-y-auto divide-y divide-slate-100 p-1 bg-slate-50">
                      {otherEmployees.length === 0 ? (
                        <p className="text-[10px] text-slate-400 p-3 text-center">No other employees added yet.</p>
                      ) : (
                        otherEmployees.map((emp) => {
                          const isSelected = editSelectedMembers.includes(emp.email || emp.phone);
                          return (
                            <div
                              key={emp.email || emp.phone}
                              onClick={() => toggleEditMemberSelection(emp.email || emp.phone)}
                              className={`flex items-center justify-between p-2 cursor-pointer rounded-lg transition-all ${
                                isSelected ? 'bg-indigo-50 text-indigo-900 font-bold border border-indigo-100/50' : 'hover:bg-slate-100 text-slate-600'
                              }`}
                            >
                              <div className="overflow-hidden mr-2">
                                <div className="text-[11px] font-bold truncate">{emp.name}</div>
                                <div className="text-[9px] text-slate-400 truncate">{emp.designation}</div>
                              </div>
                              <div className={`w-4 h-4 rounded-full border flex items-center justify-center transition-all ${
                                isSelected ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-slate-300'
                              }`}>
                                {isSelected && <span className="text-[9px]">✓</span>}
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>

                  <div className="flex justify-end gap-2.5 pt-4 border-t border-slate-100 mt-5">
                    <button
                      type="button"
                      onClick={() => setEditingProject(null)}
                      className="px-4 py-2 border border-slate-200 rounded-lg text-slate-500 hover:bg-slate-50 text-xs font-semibold transition-all cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={editProjLoading}
                      className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg shadow-md transition-all flex items-center gap-1.5 disabled:opacity-50"
                    >
                      {editProjLoading ? "Saving..." : "Save Changes"}
                    </button>
                  </div>
                </form>
              </motion.div>
            </div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
