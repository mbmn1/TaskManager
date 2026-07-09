import React, { useState, useEffect } from "react";
import { 
  FolderKanban, 
  Users, 
  TrendingUp, 
  LogOut, 
  User, 
  ShieldAlert, 
  Menu, 
  X,
  Lock,
  Phone,
  ShieldCheck,
  Building2,
  History,
  Key,
  AlertCircle
} from "lucide-react";
import { Employee, Project } from "./types";
import { subscribeEmployees, subscribeProjects, seedAdminUser } from "./lib/firestoreService";
import Login from "./components/Login";
import ProjectBoard from "./components/ProjectBoard";
import AdminPanel from "./components/AdminPanel";
import ProgressTracker from "./components/ProgressTracker";
import { motion, AnimatePresence } from "motion/react";

export default function App() {
  const [currentUser, setCurrentUser] = useState<Employee | null>(null);

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeTab, setActiveTab] = useState<'board' | 'progress' | 'employees' | 'projects' | 'logs'>('board');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  // Handle successful login
  const handleLoginSuccess = (user: Employee) => {
    setCurrentUser(user);
    const emailNorm = (user.email || "").toLowerCase().trim();
    if (user.role === 'admin' || emailNorm === 'mbmnmurali@gmail.com' || emailNorm === 'innovalleyservices@gmail.com') {
      setActiveTab('progress');
    } else {
      setActiveTab('board');
    }
  };

  // Handle Logout
  const handleLogout = () => {
    setCurrentUser(null);
  };

  // Change Password state
  const [showChangePasswordModal, setShowChangePasswordModal] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changePasswordError, setChangePasswordError] = useState<string | null>(null);
  const [changePasswordSuccess, setChangePasswordSuccess] = useState<string | null>(null);
  const [changePasswordLoading, setChangePasswordLoading] = useState(false);

  const handleChangePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setChangePasswordError(null);
    setChangePasswordSuccess(null);

    if (newPassword !== confirmPassword) {
      setChangePasswordError("New passwords do not match.");
      return;
    }

    if (newPassword.length < 4) {
      setChangePasswordError("Password must be at least 4 characters long.");
      return;
    }

    setChangePasswordLoading(true);

    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: currentUser?.email,
          currentPassword,
          newPassword
        })
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setChangePasswordSuccess("Password updated successfully!");
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
        
        // Also update local state if user updated current session info
        if (currentUser) {
          const updatedUser = { ...currentUser, password: newPassword };
          setCurrentUser(updatedUser);
        }

        setTimeout(() => {
          setShowChangePasswordModal(false);
          setChangePasswordSuccess(null);
        }, 1500);
      } else {
        setChangePasswordError(data.error || "Failed to update password.");
      }
    } catch (err: any) {
      setChangePasswordError(err.message || "Failed to connect to server.");
    } finally {
      setChangePasswordLoading(false);
    }
  };

  // Real-time listeners once logged in
  useEffect(() => {
    if (currentUser) {
      // Subscribe to all registered employees
      const unsubscribeEmployees = subscribeEmployees((updatedEmps) => {
        const seen = new Set<string>();
        const unique: any[] = [];
        // Prioritize admin roles, email IDs, and those with phone numbers
        const sorted = [...updatedEmps].sort((a, b) => {
          const aIsAdmin = a.role === "admin" ? 1 : 0;
          const bIsAdmin = b.role === "admin" ? 1 : 0;
          if (aIsAdmin !== bIsAdmin) return bIsAdmin - aIsAdmin;

          const aIsEmailId = (a.id || "").includes("@") ? 1 : 0;
          const bIsEmailId = (b.id || "").includes("@") ? 1 : 0;
          if (aIsEmailId !== bIsEmailId) return bIsEmailId - aIsEmailId;

          const aHasPhone = a.phone ? 1 : 0;
          const bHasPhone = b.phone ? 1 : 0;
          return bHasPhone - aHasPhone;
        });

        for (const emp of sorted) {
          const emailNorm = (emp.email || "").trim().toLowerCase();
          const phoneNorm = (emp.phone || "").trim();
          const idNorm = (emp.id || "").trim().toLowerCase();

          const key = emailNorm || idNorm || phoneNorm;
          if (key && !seen.has(key)) {
            seen.add(key);
            unique.push(emp);
          }
        }
        setEmployees(unique);
      });

      // Subscribe to projects (Admin gets all; Employees get their joined ones)
      const unsubscribeProjects = subscribeProjects(
        currentUser.email || "", 
        currentUser.role, 
        (updatedProjs) => {
          setProjects(updatedProjs);
        }
      );

      return () => {
        unsubscribeEmployees();
        unsubscribeProjects();
      };
    }
  }, [currentUser]);

  if (!currentUser) {
    return <Login onLoginSuccess={handleLoginSuccess} />;
  }

  const currentUserEmailNorm = (currentUser.email || "").toLowerCase().trim();
  const isUserAdmin = currentUser.role === 'admin' || currentUserEmailNorm === 'mbmnmurali@gmail.com' || currentUserEmailNorm === 'innovalleyservices@gmail.com';

  const userInitials = currentUser.name ? currentUser.name.split(" ").map((n: string) => n[0]).join("").toUpperCase().slice(0, 2) : "U";

  return (
    <div className="h-screen w-full bg-slate-50 flex font-sans overflow-hidden" id="app-root-layout">
      {/* Navigation Sidebar (Desktop Only) */}
      <aside className="w-64 bg-white border-r border-slate-200 flex flex-col shrink-0 hidden md:flex">
        <div className="p-6 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-indigo-600 rounded flex items-center justify-center text-white font-bold font-display">I</div>
            <div>
              <h1 className="font-bold text-base tracking-tight text-slate-800">Innovalley</h1>
              <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">Services Co.</p>
            </div>
          </div>
        </div>

        <nav className="flex-1 p-4 space-y-1">
          <div className="text-[10px] uppercase font-bold text-slate-400 px-3 mb-3 tracking-widest">Workspace Menu</div>
          
          {!isUserAdmin && (
            <button
              onClick={() => setActiveTab('board')}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl font-medium text-xs transition-all cursor-pointer ${
                activeTab === 'board'
                  ? 'bg-indigo-50 text-indigo-700'
                  : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
              }`}
            >
              <FolderKanban className="w-4 h-4" />
              Projects Board
            </button>
          )}

          <button
            onClick={() => setActiveTab('progress')}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl font-medium text-xs transition-all cursor-pointer ${
              activeTab === 'progress'
                ? 'bg-indigo-50 text-indigo-700'
                : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
            }`}
          >
            <TrendingUp className="w-4 h-4" />
            Progress Analytics
          </button>

          {isUserAdmin && (
            <>
              <div className="text-[10px] uppercase font-bold text-slate-400 px-3 pt-6 mb-3 tracking-widest">Admin Control</div>
              <button
                onClick={() => setActiveTab('employees')}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl font-medium text-xs transition-all cursor-pointer ${
                  activeTab === 'employees'
                    ? 'bg-indigo-50 text-indigo-700'
                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                }`}
              >
                <Users className="w-4 h-4" />
                Employee Directory
              </button>
              <button
                onClick={() => setActiveTab('projects')}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl font-medium text-xs transition-all cursor-pointer ${
                  activeTab === 'projects'
                    ? 'bg-indigo-50 text-indigo-700'
                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                }`}
              >
                <Building2 className="w-4 h-4" />
                Project Workspaces
              </button>
              <button
                onClick={() => setActiveTab('logs')}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl font-medium text-xs transition-all cursor-pointer ${
                  activeTab === 'logs'
                    ? 'bg-indigo-50 text-indigo-700'
                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                }`}
              >
                <History className="w-4 h-4" />
                System Activity Logs
              </button>
            </>
          )}
        </nav>

        {/* User Info Section */}
        <div className="p-4 border-t border-slate-100 bg-slate-50/50">
          <div className="flex items-center gap-3 p-1.5">
            <div className="w-9 h-9 rounded-full bg-indigo-100 border-2 border-indigo-200 flex items-center justify-center font-bold text-indigo-700 text-xs">
              {userInitials}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold text-slate-800 truncate">{currentUser.name}</p>
              <p className="text-[10px] font-mono text-slate-400 font-medium truncate">{currentUser.email}</p>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => {
                  setChangePasswordError(null);
                  setChangePasswordSuccess(null);
                  setCurrentPassword("");
                  setNewPassword("");
                  setConfirmPassword("");
                  setShowChangePasswordModal(true);
                }}
                title="Change Password"
                className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors cursor-pointer"
              >
                <Key className="w-4 h-4" />
              </button>
              <button
                onClick={handleLogout}
                title="Sign Out Session"
                className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Panel */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        
        {/* Top Header / Brand bar for mobile, and view metadata bar for desktop */}
        <header className="h-20 bg-white border-b border-slate-200 px-4 md:px-8 flex items-center justify-between shrink-0">
          {/* Mobile Layout Title & Burger */}
          <div className="flex items-center gap-3 md:hidden">
            <button
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              className="p-2 -ml-2 rounded-lg text-slate-500 hover:text-slate-700 hover:bg-slate-50 cursor-pointer"
            >
              {isMobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 bg-indigo-600 rounded flex items-center justify-center text-white font-bold text-sm">I</div>
              <span className="font-bold text-sm text-slate-800">Innovalley</span>
            </div>
          </div>

          {/* Desktop Layout Metadata */}
          <div className="hidden md:block">
            <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2 font-display">
              {activeTab === 'board' && "Project Workspace"}
              {activeTab === 'progress' && "Progress Analytics & Metrics"}
              {activeTab === 'employees' && "Employee Directory"}
              {activeTab === 'projects' && "Project Workspaces"}
              {activeTab === 'logs' && "System Activity Logs"}
              {isUserAdmin && (
                <span className="text-[10px] bg-indigo-100 text-indigo-700 font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
                  <ShieldCheck className="w-3 h-3" /> Admin Auth Active
                </span>
              )}
            </h2>
            <p className="text-xs text-slate-400 font-medium">
              {activeTab === 'board' && "Internal Dev Teams"}
              {activeTab === 'progress' && "Productivity Statistics & Dynamic Status Overviews"}
              {activeTab === 'employees' && "Add, Edit, and Manage members permissions"}
              {activeTab === 'projects' && "Create, Customize, and Assign project boards"}
              {activeTab === 'logs' && "System-wide operation logs audit trail"}
            </p>
          </div>

          {/* Right Action buttons */}
          <div className="flex items-center gap-3">
            <span className="text-xs font-bold text-slate-400 bg-slate-100 px-2.5 py-1 rounded-lg border border-slate-200 hidden sm:inline-block">
              {currentUser.role === 'admin' ? "Administrator" : "Employee"}
            </span>
            <button
              onClick={handleLogout}
              className="px-3.5 py-1.5 bg-slate-100 text-slate-700 hover:bg-slate-200 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 md:hidden cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" /> Out
            </button>
          </div>
        </header>

        {/* Mobile Navigation Drawer Overlay */}
        <AnimatePresence>
          {isMobileMenuOpen && (
            <motion.div
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="absolute top-20 left-0 right-0 z-50 md:hidden bg-white border-b border-slate-200 shadow-xl px-4 py-4 space-y-1"
            >
              {!isUserAdmin && (
                <button
                  onClick={() => { setActiveTab('board'); setIsMobileMenuOpen(false); }}
                  className={`w-full text-left px-4 py-3 text-xs font-bold rounded-xl flex items-center gap-2 ${
                    activeTab === 'board' ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600'
                  }`}
                >
                  <FolderKanban className="w-4 h-4" /> Project Board
                </button>
              )}
              <button
                onClick={() => { setActiveTab('progress'); setIsMobileMenuOpen(false); }}
                className={`w-full text-left px-4 py-3 text-xs font-bold rounded-xl flex items-center gap-2 ${
                  activeTab === 'progress' ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600'
                }`}
              >
                <TrendingUp className="w-4 h-4" /> Progress Tracking
              </button>
              {isUserAdmin && (
                <>
                  <button
                    onClick={() => { setActiveTab('employees'); setIsMobileMenuOpen(false); }}
                    className={`w-full text-left px-4 py-3 text-xs font-bold rounded-xl flex items-center gap-2 ${
                      activeTab === 'employees' ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600'
                    }`}
                  >
                    <Users className="w-4 h-4" /> Employee Directory
                  </button>
                  <button
                    onClick={() => { setActiveTab('projects'); setIsMobileMenuOpen(false); }}
                    className={`w-full text-left px-4 py-3 text-xs font-bold rounded-xl flex items-center gap-2 ${
                      activeTab === 'projects' ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600'
                    }`}
                  >
                    <Building2 className="w-4 h-4" /> Project Workspaces
                  </button>
                  <button
                    onClick={() => { setActiveTab('logs'); setIsMobileMenuOpen(false); }}
                    className={`w-full text-left px-4 py-3 text-xs font-bold rounded-xl flex items-center gap-2 ${
                      activeTab === 'logs' ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600'
                    }`}
                  >
                    <History className="w-4 h-4" /> System Activity Logs
                  </button>
                </>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Workflow Content Area */}
        <section className="flex-1 overflow-y-auto p-4 md:p-8 bg-slate-50/50">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              transition={{ duration: 0.2 }}
              className="h-full"
            >
              {activeTab === 'board' && (
                <ProjectBoard 
                  currentUser={currentUser} 
                  employees={employees} 
                  projects={projects} 
                />
              )}
              {activeTab === 'progress' && (
                <ProgressTracker 
                  currentUser={currentUser} 
                  employees={employees} 
                  projects={projects} 
                />
              )}
              {activeTab === 'employees' && isUserAdmin && (
                <AdminPanel 
                  currentUser={currentUser} 
                  employees={employees} 
                  projects={projects} 
                  mode="employees"
                />
              )}
              {activeTab === 'projects' && isUserAdmin && (
                <AdminPanel 
                  currentUser={currentUser} 
                  employees={employees} 
                  projects={projects} 
                  mode="projects"
                />
              )}
              {activeTab === 'logs' && isUserAdmin && (
                <AdminPanel 
                  currentUser={currentUser} 
                  employees={employees} 
                  projects={projects} 
                  mode="logs"
                />
              )}
            </motion.div>
          </AnimatePresence>
        </section>

      </div>

      {/* CHANGE PASSWORD MODAL */}
      <AnimatePresence>
        {showChangePasswordModal && (
          <div className="fixed inset-0 z-50 overflow-y-auto" id="change-password-modal">
            <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center sm:block sm:p-0">
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setShowChangePasswordModal(false)}
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
                    <Key className="w-4 h-4 text-indigo-600" />
                    <h3 className="text-base font-extrabold text-slate-900 font-display">Change Your Password</h3>
                  </div>
                  <button
                    onClick={() => setShowChangePasswordModal(false)}
                    className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-50"
                  >
                    <X className="w-4.5 h-4.5" />
                  </button>
                </div>

                <form onSubmit={handleChangePasswordSubmit} className="space-y-4">
                  {changePasswordError && (
                    <div className="bg-red-50 text-red-700 p-3 rounded-xl flex items-start gap-2 text-xs border border-red-200">
                      <AlertCircle className="w-4.5 h-4.5 shrink-0" />
                      <span>{changePasswordError}</span>
                    </div>
                  )}

                  {changePasswordSuccess && (
                    <div className="bg-emerald-50 text-emerald-800 p-3 rounded-xl flex items-start gap-2 text-xs border border-emerald-200">
                      <ShieldCheck className="w-4.5 h-4.5 text-emerald-600 shrink-0" />
                      <span>{changePasswordSuccess}</span>
                    </div>
                  )}

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">Current Password</label>
                    <input
                      type="password"
                      required
                      placeholder="Enter your current password"
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 text-xs font-medium text-slate-800"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">New Password</label>
                    <input
                      type="password"
                      required
                      placeholder="At least 4 characters long"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 text-xs font-medium text-slate-800"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">Confirm New Password</label>
                    <input
                      type="password"
                      required
                      placeholder="Repeat new password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 text-xs font-medium text-slate-800"
                    />
                  </div>

                  <div className="flex justify-end gap-2.5 pt-4 border-t border-slate-100 mt-5">
                    <button
                      type="button"
                      onClick={() => setShowChangePasswordModal(false)}
                      className="px-4 py-2 border border-slate-200 rounded-lg text-slate-500 hover:bg-slate-50 text-xs font-semibold transition-all cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={changePasswordLoading}
                      className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg shadow-md transition-all flex items-center gap-1.5 disabled:opacity-50"
                    >
                      {changePasswordLoading ? "Updating..." : "Update Password"}
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
