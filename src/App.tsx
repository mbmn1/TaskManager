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
  AlertCircle,
  Calendar, 
  Book,
  Bell,
} from "lucide-react";
import { Employee, Project, EmailNotification } from "./types";
import { fetchEmployees, fetchProjects, subscribeNotifications, fetchNotifications, fetchAllTasks } from "./lib/dbService";
import Login from "./components/Login";
import ProjectBoard from "./components/ProjectBoard";
import AdminPanel from "./components/AdminPanel";
import ProgressTracker from "./components/ProgressTracker";
import AttendanceManager from "./components/AttendanceManager";
import NotesManager from "./components/NotesManager";
import { motion, AnimatePresence } from "motion/react";

export default function App() {
  const [currentUser, setCurrentUser] = useState<Employee | null>(null);

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [allTasks, setAllTasks] = useState<any[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [notifications, setNotifications] = useState<EmailNotification[]>([]);
  const [showNotificationsDropdown, setShowNotificationsDropdown] = useState(false);
  const [selectedNotification, setSelectedNotification] = useState<EmailNotification | null>(null);

  const stripHtmlTags = (htmlStr: string) => {
    if (!htmlStr) return "";
    return htmlStr
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "") // strip style blocks first
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  };

  const [readNotificationIds, setReadNotificationIds] = useState<string[]>(() => {
    try {
      // Lazy load from localStorage after checking currentUser, but standard load here
      return JSON.parse(localStorage.getItem("read_notifications") || "[]");
    } catch {
      return [];
    }
  });

  const [activeTab, setActiveTab] = useState<'board' | 'progress' | 'employees' | 'projects' | 'logs' | 'attendance' | 'notes'>('board');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  // Handle successful login
  const handleLoginSuccess = (user: Employee) => {
    // Persist user session in local storage
    try {
      localStorage.setItem('currentUser', JSON.stringify(user));
    } catch (err) {
      console.error("Failed to save user session:", err);
    }

    setCurrentUser(user);
    if (user.role === 'admin') {
      setActiveTab('progress');
    } else if (user.role === 'client') {
      setActiveTab('board');
    } else {
      setActiveTab('board');
    }

    refetchData(user);
  };

  // Centralized data refetching function
  const refetchData = async (user = currentUser) => {
    if (!user) return;
    const [emps, projs, notifs, tasks] = await Promise.all([
      fetchEmployees(),
      fetchProjects(user.email || "", user.phone || "", user.role),
      fetchNotifications(),
      fetchAllTasks(user.email || "", user.phone || "", user.role),
    ]);
    setEmployees(emps);
    setProjects(projs);
    setNotifications(notifs);
    setAllTasks(tasks);
  };

  // Handle Logout
  const handleLogout = () => {
    // Clear persisted user session
    try {
      localStorage.removeItem('currentUser');
    } catch (err) {
      console.error("Failed to clear user session:", err);
    }
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
      setChangePasswordError("New PINs do not match.");
      return;
    }

    if (!/^[0-9]{6}$/.test(newPassword)) {
      setChangePasswordError("The new PIN must be exactly 6 numeric digits.");
      return;
    }

    setChangePasswordLoading(true);

    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: currentUser?.email,
          phone: currentUser?.phone,
          id: currentUser?.id,
          currentPassword,
          newPassword
        })
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setChangePasswordSuccess("PIN updated successfully!");
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
        setChangePasswordError(data.error || "Failed to update PIN.");
      }
    } catch (err: any) {
      setChangePasswordError(err.message || "Failed to connect to server.");
    } finally {
      setChangePasswordLoading(false);
    }
  };

  // Check for persisted session on initial app load
  useEffect(() => {
    try {
      const savedUser = localStorage.getItem('currentUser');
      if (savedUser) {
        const user = JSON.parse(savedUser);
        // Use handleLoginSuccess to re-initialize the app state
        handleLoginSuccess(user);
      }
    } catch (err) {
      console.error("Failed to load user session:", err);
    }
  }, []);

  // Real-time listeners once logged in
  useEffect(() => {
    if (currentUser) {      
      // Subscribe to real-time email/SMS notifications
      const unsubscribeNotifications = subscribeNotifications((updatedNotifs) => {
        setNotifications(updatedNotifs);
      });

      return () => {
        unsubscribeNotifications();
      };
    }
  }, [currentUser]);

  if (!currentUser) {
    return <Login onLoginSuccess={handleLoginSuccess} />;
  }

  const currentUserEmailNorm = (currentUser.email || "").toLowerCase().trim();
  const isUserAdmin = currentUser.role === 'admin';

  const filteredNotifications = notifications.filter(notif => {
    if (isUserAdmin) return true;
    const targetEmail = (currentUser?.email || "").trim().toLowerCase();
    const targetPhone = (currentUser?.phone || "").trim().replace(/[^0-9]/g, "");
    const notifEmail = (notif.toEmail || "").trim().toLowerCase();
    return notifEmail === targetEmail || (targetPhone && notifEmail.includes(targetPhone));
  });

  const unreadNotificationsCount = filteredNotifications.filter(notif => !readNotificationIds.includes(notif.id)).length;

  const handleMarkAllNotificationsRead = () => {
    const allIds = filteredNotifications.map(n => n.id);
    setReadNotificationIds(allIds);
    localStorage.setItem("read_notifications", JSON.stringify(allIds));
  };

  const handleSelectNotification = (notif: EmailNotification) => {
    setSelectedNotification(notif);
    setShowNotificationsDropdown(false);
    if (!readNotificationIds.includes(notif.id)) {
      const updatedIds = [...readNotificationIds, notif.id];
      setReadNotificationIds(updatedIds);
      localStorage.setItem("read_notifications", JSON.stringify(updatedIds));
    }
  };

  const userInitials = currentUser.name ? currentUser.name.split(" ").map((n: string) => n[0]).join("").toUpperCase().slice(0, 2) : "U";

  return (
    <div className="h-screen w-full bg-slate-50 flex font-sans overflow-hidden" id="app-root-layout">
      {/* Navigation Sidebar (Desktop Only) */}
      <aside className="w-64 bg-white border-r border-slate-200 flex flex-col shrink-0 hidden md:flex">
        <div className="p-6 border-b border-slate-100">
          <div>
            <h1 className="font-extrabold text-xl tracking-tight text-slate-900 font-display">Innovalley</h1>
            <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">workspace</p>
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

          {currentUser.role === 'employee' && (
            <button
              onClick={() => setActiveTab('notes')}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl font-medium text-xs transition-all cursor-pointer ${
                activeTab === 'notes'
                  ? 'bg-indigo-50 text-indigo-700'
                  : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
              }`}
            >
              <Book className="w-4 h-4" />
              My Notes
            </button>
          )}

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
                Users Directory
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

          {(isUserAdmin || (currentUser.role === 'employee' && currentUser.trackAttendance !== false)) && (
            <button
              onClick={() => setActiveTab('attendance')}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl font-medium text-xs transition-all cursor-pointer ${
                activeTab === 'attendance'
                  ? 'bg-indigo-50 text-indigo-700'
                  : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
              }`}
            >
              <Calendar className="w-4 h-4" />
              Attendance Desk
            </button>
          )}

          {currentUser.role !== 'client' && (
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
          )}

        </nav>

        {/* User Info Section */}
        <div className="p-4 border-t border-slate-100 bg-slate-50/50">
          <div className="flex items-center gap-3 p-1.5">
            <div className="w-9 h-9 rounded-full bg-indigo-100 border-2 border-indigo-200 grid place-content-center font-bold text-indigo-700 text-xs shrink-0">
              {userInitials}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold text-slate-800 truncate">{currentUser.name}</p>
              <p className="text-[10px] font-mono text-slate-400 font-medium truncate">{currentUser.email}</p>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button
                onClick={() => {
                  setChangePasswordError(null);
                  setChangePasswordSuccess(null);
                  setCurrentPassword("");
                  setNewPassword("");
                  setConfirmPassword("");
                  setShowChangePasswordModal(true);
                }}
                title="Change Login PIN"
                className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors cursor-pointer"
              >
                <Key className="w-4 h-4" />
              </button>
              <button
                onClick={handleLogout}
                title="Sign Out Session"
                className="p-1.5 text-slate-400 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
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
            <div className="flex flex-col justify-center">
              <span className="font-extrabold text-base text-slate-900 tracking-tight leading-none font-display">Innovalley</span>
              <span className="text-[9px] text-slate-400 font-bold uppercase tracking-wider mt-0.5 leading-none">workspace</span>
            </div>
          </div>

          {/* Desktop Layout Metadata */}
          <div className="hidden md:block">
            <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2 font-display">
              {activeTab === 'board' && "Project Workspace"}
              {activeTab === 'progress' && "Progress Analytics & Metrics"}
              {activeTab === 'employees' && "Users Directory"}
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
              {activeTab === 'employees' && "Add, Edit, and Manage user access and permissions"}
              {activeTab === 'projects' && "Create, Customize, and Assign project boards"}
              {activeTab === 'logs' && "System-wide operation logs audit trail"}
              {activeTab === 'notes' && "Create and manage your personal notes"}
            </p>
          </div>

          {/* Right Action buttons */}
          <div className="flex items-center gap-2 sm:gap-3">
            {/* Notification Bell */}
            <div className="relative" id="notifications-bell-container">
              <button
                onClick={() => setShowNotificationsDropdown(!showNotificationsDropdown)}
                className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors cursor-pointer relative"
                title="Notifications"
                id="notifications-bell-btn"
              >
                <Bell className="w-4.5 h-4.5" />
                {unreadNotificationsCount > 0 && (
                  <span className="absolute top-1 right-1 w-2 h-2 bg-rose-500 rounded-full ring-2 ring-white animate-bounce" />
                )}
              </button>
              
              {showNotificationsDropdown && (
                <div className="absolute right-0 mt-2 w-80 bg-white border border-slate-200 rounded-2xl shadow-xl z-50 overflow-hidden py-1 max-h-96 flex flex-col" id="notifications-dropdown-menu">
                  <div className="px-4 py-2.5 border-b border-slate-100 flex items-center justify-between bg-slate-50">
                    <span className="text-xs font-bold text-slate-800">Notifications ({filteredNotifications.length})</span>
                    {unreadNotificationsCount > 0 && (
                      <button
                        onClick={handleMarkAllNotificationsRead}
                        className="text-[10px] text-indigo-600 hover:text-indigo-700 font-bold cursor-pointer"
                      >
                        Mark all read
                      </button>
                    )}
                  </div>
                  <div className="overflow-y-auto flex-1 divide-y divide-slate-100 max-h-80">
                    {filteredNotifications.length === 0 ? (
                      <div className="py-8 text-center text-slate-400 text-xs font-medium">
                        No notifications found.
                      </div>
                    ) : (
                      filteredNotifications.map((notif) => {
                        const isRead = readNotificationIds.includes(notif.id);
                        const cleanPreview = stripHtmlTags(notif.body);
                        return (
                          <button
                            key={notif.id}
                            onClick={() => handleSelectNotification(notif)}
                            className={`w-full p-3.5 text-left transition-all hover:bg-slate-50 flex flex-col cursor-pointer border-l-2 ${
                              isRead ? 'border-transparent opacity-75' : 'border-indigo-500 bg-indigo-500/10'
                            }`}
                          >
                            <div className="flex items-start justify-between gap-1.5 mb-1 w-full">
                              <span className="text-[9px] font-extrabold text-indigo-700 truncate bg-indigo-100/60 px-1.5 py-0.5 rounded">
                                {notif.projectName || "System"}
                              </span>
                              <span className="text-[9px] text-slate-400 font-mono">
                                {new Date(notif.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </span>
                            </div>
                            <p className="text-xs font-bold text-slate-800 mb-1 line-clamp-1">{notif.subject}</p>
                            <p className="text-[11px] text-slate-500 leading-relaxed line-clamp-2">{cleanPreview || "Click to view update details"}</p>
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>
              )}
            </div>
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
              {currentUser.role === 'employee' && (
                <button
                  onClick={() => { setActiveTab('notes'); setIsMobileMenuOpen(false); }}
                  className={`w-full text-left px-4 py-3 text-xs font-bold rounded-xl flex items-center gap-2 ${
                    activeTab === 'notes' ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600'
                  }`}
                >
                  <Book className="w-4 h-4" /> My Notes
                </button>
              )}
              {isUserAdmin && (
                <>
                  <button
                    onClick={() => { setActiveTab('employees'); setIsMobileMenuOpen(false); }}
                    className={`w-full text-left px-4 py-3 text-xs font-bold rounded-xl flex items-center gap-2 ${
                      activeTab === 'employees' ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600'
                    }`}
                  >
                    <Users className="w-4 h-4" /> Users Directory
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
              {(isUserAdmin || (currentUser.role === 'employee' && currentUser.trackAttendance !== false)) && (
                <button
                  onClick={() => { setActiveTab('attendance'); setIsMobileMenuOpen(false); }}
                  className={`w-full text-left px-4 py-3 text-xs font-bold rounded-xl flex items-center gap-2 ${
                    activeTab === 'attendance' ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600'
                  }`}
                >
                  <Calendar className="w-4 h-4" /> Attendance Desk
                </button>
              )}
              {currentUser.role !== 'client' && (
                <button
                  onClick={() => { setActiveTab('progress'); setIsMobileMenuOpen(false); }}
                  className={`w-full text-left px-4 py-3 text-xs font-bold rounded-xl flex items-center gap-2 ${
                    activeTab === 'progress' ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600'
                  }`}
                >
                  <TrendingUp className="w-4 h-4" /> Progress Tracking
                </button>
              )}
              
              {/* Change PIN and Sign Out Action Side by Side */}
              <div className="flex gap-2 border-t border-slate-100 pt-3 mt-2 px-2">
                <button
                  onClick={() => {
                    setChangePasswordError(null);
                    setChangePasswordSuccess(null);
                    setCurrentPassword("");
                    setNewPassword("");
                    setConfirmPassword("");
                    setShowChangePasswordModal(true);
                    setIsMobileMenuOpen(false);
                  }}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-bold text-indigo-600 bg-indigo-50 hover:bg-indigo-100/80 transition-colors cursor-pointer"
                  title="Change Login PIN"
                >
                  <Key className="w-4 h-4" />
                  <span>Change PIN</span>
                </button>
                <button
                  onClick={() => {
                    handleLogout();
                    setIsMobileMenuOpen(false);
                  }}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-bold text-rose-600 bg-rose-50 hover:bg-rose-100/80 transition-colors cursor-pointer"
                  title="Sign Out Session"
                >
                  <LogOut className="w-4 h-4" />
                  <span>Sign Out</span>
                </button>
              </div>
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
                onDataUpdate={refetchData}
                />
              )}
              {activeTab === 'progress' && (
                <ProgressTracker 
                  currentUser={currentUser} 
                  employees={employees} 
                  allTasks={allTasks}
                  projects={projects} 
                />
              )}
              {activeTab === 'employees' && isUserAdmin && (
                <AdminPanel 
                  currentUser={currentUser} 
                  employees={employees} 
                  projects={projects} 
                  allTasks={allTasks}
                  mode="employees"
                  onDataUpdate={refetchData}
                />
              )}
              {activeTab === 'projects' && isUserAdmin && (
                <AdminPanel 
                  currentUser={currentUser} 
                  employees={employees} 
                  projects={projects} 
                  allTasks={allTasks}
                  mode="projects"
                  onDataUpdate={refetchData}
                />
              )}
              {activeTab === 'logs' && isUserAdmin && (
                <AdminPanel 
                  currentUser={currentUser} 
                  employees={employees} 
                  projects={projects} 
                  allTasks={allTasks}
                  mode="logs"
                  onDataUpdate={refetchData}
                />
              )}
              {activeTab === 'attendance' && (isUserAdmin || currentUser.role === 'employee') && (
                <AttendanceManager 
                  currentUser={currentUser} 
                  employees={employees} 
                />
              )}
              {activeTab === 'notes' && currentUser.role === 'employee' && (
                <NotesManager
                  currentUser={currentUser}
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
                className="relative z-10 inline-block w-full max-w-md p-6 my-8 overflow-hidden text-left align-middle transition-all transform bg-white shadow-2xl rounded-2xl border border-slate-100 sm:align-middle"
              >
                <div className="flex items-center justify-between pb-4 border-b border-slate-100 mb-4">
                  <div className="flex items-center gap-2">
                    <Key className="w-4 h-4 text-indigo-600" />
                    <h3 className="text-base font-extrabold text-slate-900 font-display">Change Your Login PIN</h3>
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
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">Current PIN</label>
                    <input
                      type="password"
                      required
                      inputMode="numeric"
                      pattern="[0-9]*"
                      maxLength={6}
                      placeholder="Enter current 6-digit PIN"
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value.replace(/[^0-9]/g, ""))}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 text-xs font-bold font-mono text-slate-800 tracking-widest"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">New 6-Digit PIN</label>
                    <input
                      type="password"
                      required
                      inputMode="numeric"
                      pattern="[0-9]*"
                      maxLength={6}
                      placeholder="Enter exactly 6 digits"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value.replace(/[^0-9]/g, ""))}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 text-xs font-bold font-mono text-slate-800 tracking-widest"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">Confirm New PIN</label>
                    <input
                      type="password"
                      required
                      inputMode="numeric"
                      pattern="[0-9]*"
                      maxLength={6}
                      placeholder="Confirm new 6-digit PIN"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value.replace(/[^0-9]/g, ""))}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 text-xs font-bold font-mono text-slate-800 tracking-widest"
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
                      {changePasswordLoading ? "Updating..." : "Update PIN"}
                    </button>
                  </div>
                </form>
              </motion.div>
            </div>
          </div>
        )}
      </AnimatePresence>

      {/* NOTIFICATION DETAIL MODAL */}
      <AnimatePresence>
        {selectedNotification && (
          <div className="fixed inset-0 z-50 overflow-y-auto" id="notification-detail-modal">
            <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center sm:block sm:p-0">
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setSelectedNotification(null)}
                className="fixed inset-0 transition-opacity bg-slate-900/60"
              />
              <span className="hidden sm:inline-block sm:align-middle sm:h-screen" aria-hidden="true">&#8203;</span>
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 15 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 15 }}
                className="relative z-10 inline-block w-full max-w-2xl p-6 my-8 overflow-hidden text-left align-middle transition-all transform bg-white shadow-2xl rounded-2xl border border-slate-100 sm:align-middle"
              >
                <div className="flex items-center justify-between pb-4 border-b border-slate-100 mb-4">
                  <div className="flex items-center gap-2">
                    <span className="p-1.5 bg-indigo-50 text-indigo-600 rounded-lg">
                      <Bell className="w-4 h-4" />
                    </span>
                    <div>
                      <h3 className="text-xs font-bold text-indigo-600 uppercase tracking-wider">{selectedNotification.projectName || "System Updates"}</h3>
                      <p className="text-[10px] text-slate-400 font-medium">{new Date(selectedNotification.timestamp).toLocaleString()}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => setSelectedNotification(null)}
                    className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-50 cursor-pointer"
                  >
                    <X className="w-4.5 h-4.5" />
                  </button>
                </div>

                <div className="space-y-4">
                  <h4 className="text-sm font-extrabold text-slate-900 font-display">
                    {selectedNotification.subject}
                  </h4>

                  {/* Render HTML cleanly within a protected container */}
                  <div className="border border-slate-100 rounded-xl overflow-hidden bg-slate-50 max-h-[420px] overflow-y-auto p-4 md:p-6" id="notification-html-body">
                    <div 
                      dangerouslySetInnerHTML={{ __html: selectedNotification.body }}
                      className="prose prose-slate prose-xs max-w-none break-words"
                    />
                  </div>
                </div>

                <div className="flex justify-end pt-4 border-t border-slate-100 mt-5">
                  <button
                    type="button"
                    onClick={() => setSelectedNotification(null)}
                    className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl shadow-md transition-all cursor-pointer"
                  >
                    Close Notification
                  </button>
                </div>
              </motion.div>
            </div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
