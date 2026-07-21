import React, { useState, useEffect } from "react";
import { 
  Plus, 
  Paperclip, 
  FileText, 
  Users, 
  ArrowRight, 
  CheckCircle, 
  Clock, 
  AlertCircle, 
  Download, 
  ChevronRight, 
  UserPlus, 
  Trash2,
  Calendar,
  Send,
  Sparkles,
  RefreshCw,
  FolderOpen,
  ArrowRightLeft,
  X,
  ChevronDown,
  ChevronUp
} from "lucide-react";
import { Employee, Project, Task, TaskAttachment } from "../types";
import { createTask, updateTaskStatus, fetchTasks, fetchEmployees, fetchProjects } from "../lib/dbService";
import { motion, AnimatePresence } from "motion/react";

interface ProjectBoardProps {
  currentUser: Employee;
  employees: Employee[];
  projects: Project[];
  onDataUpdate: () => void;
}


export const robustFindEmployee = (employees: Employee[], identifier: string) => {
  if (!identifier) return undefined;
  const cleanId = identifier.trim().toLowerCase();
  // Try exact email match first
  let found = employees.find(emp => emp.email && emp.email.trim().toLowerCase() === cleanId);
  if (found) return found;

  // Try ID match
  found = employees.find(emp => emp.id === identifier);
  if (found) return found;

  // Try phone match
  const cleanPhone = identifier.replace(/[^0-9]/g, "");
  if (cleanPhone) {
    found = employees.find(emp => emp.phone && emp.phone.replace(/[^0-9]/g, "") === cleanPhone);
    if (found) return found;
  }
  return found;
};

export const downloadAttachment = (attachment: TaskAttachment) => {
  try {
    const link = document.createElement('a');
    link.href = attachment.data;
    link.download = attachment.name;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  } catch (err) {
    console.error("Failed to download attachment:", err);
  }
};

export default function ProjectBoard({ currentUser, employees, projects, onDataUpdate }: ProjectBoardProps) {
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [activeBoardTab, setActiveBoardTab] = useState<'assigned' | 'in progress' | 'completed' | 'tracker'>(
    currentUser.role === 'client' ? 'tracker' : 'assigned'
  );

  // New task form modal state
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [taskTitle, setTaskTitle] = useState("");
  const [taskDesc, setTaskDesc] = useState("");
  const [taskAssignees, setTaskAssignees] = useState<string[]>([]);
  const [taskAttachment, setTaskAttachment] = useState<TaskAttachment | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [taskError, setTaskError] = useState<string | null>(null);
  const [taskSuccess, setTaskSuccess] = useState(false);
  const [taskLoading, setTaskLoading] = useState(false);

  // Active Project Selected
  const selectedProject = projects.find(p => p.id === selectedProjectId);

  // Set first project as selected initially
  useEffect(() => {
    if (projects.length > 0 && !selectedProjectId) {
      setSelectedProjectId(projects[0].id);
    }
  }, [projects, selectedProjectId]);

  const refetchTasks = () => {
    if (selectedProjectId) {
      setLoadingTasks(true);
      fetchTasks(selectedProjectId, currentUser.email || "", currentUser.phone || "", currentUser.role).then(updatedTasks => {
        setTasks(updatedTasks);
        setLoadingTasks(false);
      });
    }
  };

  // Subscribe to tasks of selected project
  useEffect(() => {
    refetchTasks();
    // We will refetch manually on actions instead of polling
  }, [selectedProjectId, currentUser]);

  // Employees registered in this project (with robust matching), excluding the administrator
  const projectMembers = selectedProject 
    ? employees.filter(emp => emp.role !== "admin" && emp.role !== "client" && selectedProject.members.some(m => {
        const cleanM = m.trim().toLowerCase();
        const empM = (emp.email || "").trim().toLowerCase();
        return cleanM === empM || m === emp.phone;
      }))
    : [];

  const assignableMembers = [
    ...projectMembers,
    ...(projectMembers.every(pm => pm.phone !== currentUser.phone) && currentUser.role === 'employee' ? [currentUser] : [])
  ];



  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processFile(file);
    }
  };

  const processFile = (file: File) => {
    setTaskError(null);
    if (file.size > 50 * 1024 * 1024) {
      setTaskError("Attachment file size is too large (Max limit is 50MB).");
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      if (event.target?.result) {
        setTaskAttachment({
          name: file.name,
          type: file.type,
          size: file.size,
          data: event.target.result as string
        });
      }
    };
    reader.onerror = () => {
      setTaskError("Failed to read the file. Please try again.");
    };
    reader.readAsDataURL(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) { 
      processFile(file);
    }
  };

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    setTaskError(null);
    setTaskLoading(true);

    if (!taskTitle.trim() || taskAssignees.length === 0) {
      setTaskError("Please provide a task title and select at least one assignee.");
      setTaskLoading(false);
      return;
    }

    if (!selectedProject) {
      setTaskError("Invalid assignment parameters.");
      setTaskLoading(false);
      return;
    }

    try {
      for (const phone of taskAssignees) {
        const assigneeEmployee = robustFindEmployee(employees, phone);
        if (!assigneeEmployee) {
          console.warn("Could not find employee for phone:", phone);
          continue;
        }

        const isSelfAssign = assigneeEmployee.phone === currentUser.phone;

        await createTask({
          projectId: selectedProject.id,
          title: taskTitle.trim(),
          description: taskDesc.trim(),
          assignedTo: phone,
          assignedBy: currentUser.phone || currentUser.email,
          status: isSelfAssign ? 'in progress' : 'assigned',
          attachment: taskAttachment
        }, selectedProject, currentUser, assigneeEmployee);
      }

      // Reset
      setTaskTitle("");
      setTaskDesc("");
      setTaskAssignees([]);
      setTaskAttachment(null);
      setTaskSuccess(true);
      refetchTasks();
      onDataUpdate(); // Trigger global refresh
      setShowTaskModal(false);
      setTimeout(() => {
        setTaskSuccess(false);
      }, 1500);
    } catch (err: any) {
      setTaskError(err.message || "Failed to create task.");
    } finally {
      setTaskLoading(false);
    }
  };

  const handleStatusChange = async (
    task: Task, 
    newStatus: 'assigned' | 'rejected' | 'in progress' | 'completed',
    extra?: { rejectionNotes?: string; notDoneNotes?: string; completedRemarks?: string; completionAttachment?: TaskAttachment | null }
  ) => {
    if (!selectedProject) return;
    const assigneeEmployee = robustFindEmployee(employees, task.assignedTo);
    if (!assigneeEmployee) return;

    try {
      await updateTaskStatus(task, newStatus, selectedProject, currentUser, assigneeEmployee, extra);
      onDataUpdate(); // This is the key change to trigger a global refresh
      refetchTasks();
    } catch (err) {
      console.error("Failed to update status:", err);
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = 1;
    const sizes = ['Bytes', 'KB', 'MB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  };

  const getStatusColor = (status: Task['status']) => {
    switch (status) {
      case 'assigned': return 'bg-blue-50 text-blue-700 border-blue-200';
      case 'rejected': return 'bg-red-50 text-red-700 border-red-200';
      case 'in progress': return 'bg-amber-50 text-amber-700 border-amber-200';
      case 'completed': return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    }
  };

  // Filter tasks: standard users see tasks assigned to them OR assigned by them. Admin sees everything.
  const userTasks = tasks.filter(t => {
    if (currentUser.role === 'admin') return true;
    const cleanEmail = (currentUser.email || "").trim().toLowerCase();
    const cleanPhone = (currentUser.phone || "").trim();
    return (
      (t.assignedTo && (t.assignedTo.trim().toLowerCase() === cleanEmail || t.assignedTo === cleanPhone)) ||
      (t.assignedBy && (t.assignedBy.trim().toLowerCase() === cleanEmail || t.assignedBy === cleanPhone))
    );
  });

  // Group tasks: personal board tabs (Assigned, In Progress, Completed) should ONLY show tasks assigned TO the user
  const tasksAssigned = userTasks.filter(t => t.status === 'assigned' && t.assignedTo && (t.assignedTo.trim().toLowerCase() === (currentUser.email || "").trim().toLowerCase() || t.assignedTo === currentUser.phone));
  const tasksInProgress = userTasks.filter(t => t.status === 'in progress' && t.assignedTo && (t.assignedTo.trim().toLowerCase() === (currentUser.email || "").trim().toLowerCase() || t.assignedTo === currentUser.phone));
  const tasksCompleted = userTasks.filter(t => t.status === 'completed' && t.assignedTo && (t.assignedTo.trim().toLowerCase() === (currentUser.email || "").trim().toLowerCase() || t.assignedTo === currentUser.phone));

  return (
    <div className="font-sans space-y-6" id="project-board-view">
      {/* Project Selector Bar */}
      <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex items-center gap-3 w-full md:w-auto">
          <div className="p-2.5 bg-indigo-50 text-indigo-600 rounded-xl shrink-0">
            <FolderOpen className="w-5 h-5" />
          </div>
          <div className="w-full">
            <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-1">Select Current Project Workspace</label>
            {projects.length === 0 ? (
              <p className="text-sm font-semibold text-slate-500">No projects available</p>
            ) : (
              <select
                value={selectedProjectId}
                onChange={(e) => setSelectedProjectId(e.target.value)}
                className="w-full md:w-72 bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
              >
                {projects.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            )}
          </div>
        </div>

        {selectedProject && (
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex -space-x-2 overflow-hidden">
              {projectMembers.map((emp) => (
                <div 
                  key={emp.phone} 
                  title={`${emp.name} (${emp.designation})`}
                  className="inline-block h-8 w-8 rounded-full ring-2 ring-white bg-indigo-100 grid place-content-center text-center text-xs font-bold text-indigo-700"
                >
                  {emp.name.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase()}
                </div>
              ))}
            </div>
            <button
              onClick={() => setShowTaskModal(true)}
              id="add-task-trigger"
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-xl shadow-md transition-all flex items-center gap-1.5"
            >
              <Plus className="w-4 h-4" />
              <span>Assign New Task</span>
            </button>
          </div>
        )}
      </div>

      {selectedProject ? (
        <div className="space-y-6">
          {/* Project Header Info */}
          <div className="bg-slate-100/50 p-4 rounded-xl border border-slate-200/50">
            <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Workspace Details</h4>
            <h3 className="text-lg font-bold text-slate-800">{selectedProject.name}</h3>
            <p className="text-sm text-slate-600 mt-1">{selectedProject.description || "No description provided."}</p>
          </div>

          {/* Kanban / Tasks Board with Tabs for better UX */}
          <div className="flex border-b border-slate-200 mb-6 gap-2 overflow-x-auto pb-px" id="board-tabs-bar">
            {currentUser.role !== 'client' && (
              <>
                <button
                  onClick={() => setActiveBoardTab('assigned')}
                  className={`pb-3 px-4 text-xs font-bold uppercase tracking-wider border-b-2 transition-all shrink-0 flex items-center gap-2 ${
                    activeBoardTab === 'assigned'
                      ? 'border-indigo-600 text-indigo-600'
                      : 'border-transparent text-slate-400 hover:text-slate-600'
                  }`}
                >
                  <Clock className="w-4 h-4 text-blue-500" />
                  <span>Assigned Tasks</span>
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                    activeBoardTab === 'assigned' ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-500'
                  }`}>
                    {tasksAssigned.length}
                  </span>
                </button>

                <button
                  onClick={() => setActiveBoardTab('in progress')}
                  className={`pb-3 px-4 text-xs font-bold uppercase tracking-wider border-b-2 transition-all shrink-0 flex items-center gap-2 ${
                    activeBoardTab === 'in progress'
                      ? 'border-indigo-600 text-indigo-600'
                      : 'border-transparent text-slate-400 hover:text-slate-600'
                  }`}
                >
                  <Clock className="w-4 h-4 text-amber-500 animate-pulse" />
                  <span>In Progress</span>
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                    activeBoardTab === 'in progress' ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-500'
                  }`}>
                    {tasksInProgress.length}
                  </span>
                </button>

                <button
                  onClick={() => setActiveBoardTab('completed')}
                  className={`pb-3 px-4 text-xs font-bold uppercase tracking-wider border-b-2 transition-all shrink-0 flex items-center gap-2 ${
                    activeBoardTab === 'completed'
                      ? 'border-indigo-600 text-indigo-600'
                      : 'border-transparent text-slate-400 hover:text-slate-600'
                  }`}
                >
                  <CheckCircle className="w-4 h-4 text-emerald-500" />
                  <span>Completed</span>
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                    activeBoardTab === 'completed' ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-500'
                  }`}>
                    {tasksCompleted.length}
                  </span>
                </button>
              </>
            )}

            <button
              onClick={() => setActiveBoardTab('tracker')}
              className={`pb-3 px-4 text-xs font-bold uppercase tracking-wider border-b-2 transition-all shrink-0 flex items-center gap-2 ${
                activeBoardTab === 'tracker'
                  ? 'border-indigo-600 text-indigo-600'
                  : 'border-transparent text-slate-400 hover:text-slate-600'
              }`}
            >
              <Users className="w-4 h-4 text-purple-500" />
              <span>{currentUser.role === 'client' ? 'My Added Tasks Tracker' : 'Sent Tasks Tracker'}</span>
              <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                activeBoardTab === 'tracker' ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-500'
              }`}>
                {userTasks.filter(t => t.assignedBy === currentUser.phone || t.assignedBy === currentUser.email).length}
              </span>
            </button>
          </div>

          <div className="space-y-4">
            {activeBoardTab === 'assigned' && (
              <div className="space-y-4">
                <div className="bg-slate-50 p-5 rounded-2xl border border-slate-200/60 min-h-[400px]">
                  {tasksAssigned.length === 0 ? (
                    <div className="text-center py-20 bg-white rounded-xl border border-dashed border-slate-200">
                      <p className="text-sm font-semibold text-slate-400">No tasks currently assigned.</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                      {tasksAssigned.map(t => (
                        <TaskCard 
                          key={t.id} 
                          task={t} 
                          project={selectedProject} 
                          employees={employees} 
                          onStatusChange={handleStatusChange} 
                          formatFileSize={formatFileSize}
                          currentUser={currentUser}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {activeBoardTab === 'in progress' && (
              <div className="space-y-4">
                <div className="bg-slate-50 p-5 rounded-2xl border border-slate-200/60 min-h-[400px]">
                  {tasksInProgress.length === 0 ? (
                    <div className="text-center py-20 bg-white rounded-xl border border-dashed border-slate-200">
                      <p className="text-sm font-semibold text-slate-400">No tasks currently in progress.</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                      {tasksInProgress.map(t => (
                        <TaskCard 
                          key={t.id} 
                          task={t} 
                          project={selectedProject} 
                          employees={employees} 
                          onStatusChange={handleStatusChange} 
                          formatFileSize={formatFileSize}
                          currentUser={currentUser}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {activeBoardTab === 'completed' && (
              <div className="space-y-4">
                <div className="bg-slate-50 p-5 rounded-2xl border border-slate-200/60 min-h-[400px]">
                  {tasksCompleted.length === 0 ? (
                    <div className="text-center py-20 bg-white rounded-xl border border-dashed border-slate-200">
                      <p className="text-sm font-semibold text-slate-400">No tasks completed yet.</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                      {tasksCompleted.map(t => (
                        <TaskCard 
                          key={t.id} 
                          task={t} 
                          project={selectedProject} 
                          employees={employees} 
                          onStatusChange={handleStatusChange} 
                          formatFileSize={formatFileSize}
                          currentUser={currentUser}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {activeBoardTab === 'tracker' && (
              <SentTasksTrackerPanel 
                userTasks={userTasks}
                currentUser={currentUser}
                employees={employees}
                selectedProject={selectedProject}
                formatFileSize={formatFileSize}
                onAddTask={() => setShowTaskModal(true)}
              />
            )}
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-2xl p-12 text-center border border-slate-100 shadow-sm">
          <FolderOpen className="w-12 h-12 mx-auto text-slate-300 mb-3" />
          <h3 className="text-lg font-bold text-slate-800">No Projects Found</h3>
          <p className="text-sm text-slate-500 mt-1 max-w-sm mx-auto">
            Please log in as Adin (9848884897) and navigate to the Admin Dashboard to create your first project.
          </p>
        </div>
      )}

      {/* NEW TASK MODAL */}
      <AnimatePresence>
        {showTaskModal && selectedProject && (
          <div className="fixed inset-0 z-50 overflow-y-auto animate-fade-in" id="task-modal-backdrop">
            <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center sm:block sm:p-0">
              <div className="fixed inset-0 transition-opacity bg-slate-900/70" onClick={() => setShowTaskModal(false)}></div>

              <span className="hidden sm:inline-block sm:align-middle sm:h-screen">&#8203;</span>

              <motion.div 
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="relative z-10 inline-block w-full max-w-lg p-6 my-8 overflow-hidden text-left align-middle transition-all transform bg-white shadow-2xl rounded-2xl border border-slate-100 sm:align-middle"
              >
                <div className="flex items-center justify-between pb-4 border-b border-slate-100">
                  <div>
                    <h3 className="text-lg font-bold text-slate-900 flex items-center gap-1.5">
                      <Sparkles className="w-5 h-5 text-indigo-600 animate-pulse" />
                      Create & Assign Task
                    </h3>
                    <p className="text-xs text-slate-500">Project: {selectedProject.name}</p>
                  </div>
                  <button 
                    onClick={() => setShowTaskModal(false)}
                    className="p-1 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors text-sm font-bold"
                  >
                    ✕
                  </button>
                </div>

                <form onSubmit={handleCreateTask} className="mt-4 space-y-4">
                  {taskError && (
                    <div className="bg-red-50 text-red-700 p-3 rounded-xl flex items-start gap-2 text-sm border border-red-200">
                      <AlertCircle className="w-5 h-5 shrink-0" />
                      <span>{taskError}</span>
                    </div>
                  )}

                  {taskSuccess && (
                    <div className="bg-emerald-50 text-emerald-800 p-3 rounded-xl flex items-center gap-2 text-sm border border-emerald-200">
                      <CheckCircle className="w-5 h-5 text-emerald-600" />
                      <span>Task created & team notified successfully!</span>
                    </div>
                  )}

                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Task Title</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Design landing page layouts"
                      value={taskTitle}
                      onChange={(e) => setTaskTitle(e.target.value)}
                      className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 text-sm font-medium placeholder-slate-400 text-slate-800"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Assigned Team Members (Check all that apply)</label>
                    <div className="max-h-36 overflow-y-auto border border-slate-200 rounded-xl p-2.5 space-y-1.5 bg-slate-50">
                      {assignableMembers.length === 0 ? (
                        <p className="text-xs text-slate-400 p-1">No team members admitted to this workspace yet.</p>
                      ) : (
                        assignableMembers.map(emp => {
                          const isChecked = taskAssignees.includes(emp.phone || emp.email);
                          return (
                            <label key={emp.phone} className="flex items-center gap-2 px-2 py-1.5 hover:bg-white rounded-lg cursor-pointer transition-colors border border-transparent hover:border-slate-100">
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={() => {
                                  if (isChecked) {
                                    setTaskAssignees(taskAssignees.filter(id => id !== (emp.phone || emp.email)));
                                  } else {
                                    setTaskAssignees([...taskAssignees, (emp.phone || emp.email)]);
                                  }
                                }}
                                className="rounded text-indigo-600 focus:ring-indigo-500 w-4 h-4"
                              />
                              <div className="text-xs">
                                {emp.phone === currentUser.phone && <span className="font-bold text-indigo-600">(Myself) </span>}
                                <span className="font-bold text-slate-800">{emp.name}</span>
                                <span className="text-slate-400 ml-1.5">({emp.designation})</span>
                              </div>
                            </label>
                          );
                        })
                      )}
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Additional Context / Instructions</label>
                    <textarea
                      rows={3}
                      placeholder="Specify task requirements, reference details..."
                      value={taskDesc}
                      onChange={(e) => setTaskDesc(e.target.value)}
                      className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 text-sm font-medium placeholder-slate-400 text-slate-800"
                    />
                  </div>

                  {/* Attachment area supporting drag and drop */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Add Attachment Context (Optional)</label>
                    <div
                      onDragOver={handleDragOver}
                      onDragLeave={handleDragLeave}
                      onDrop={handleDrop}
                      className={`border-2 border-dashed rounded-xl p-4 text-center cursor-pointer transition-all ${
                        isDragOver ? 'border-indigo-500 bg-indigo-50/50' : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                      }`}
                      onClick={() => document.getElementById('task-attachment-picker')?.click()}
                    >
                      <input
                        type="file"
                        id="task-attachment-picker"
                        className="hidden"
                        onChange={handleFileChange}
                      />
                      {taskAttachment ? (
                        <div className="flex items-center justify-between bg-indigo-50/50 p-2.5 rounded-lg border border-indigo-100 text-left">
                          <div className="flex items-center gap-2 overflow-hidden mr-2">
                            <FileText className="w-5 h-5 text-indigo-500 shrink-0" />
                            <div className="overflow-hidden">
                              <p className="text-xs font-semibold text-indigo-900 truncate">{taskAttachment.name}</p>
                              <p className="text-[10px] text-indigo-500 font-mono">{formatFileSize(taskAttachment.size)}</p>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setTaskAttachment(null);
                            }}
                            className="text-xs font-bold text-red-500 hover:text-red-700 bg-white hover:bg-red-50 p-1 rounded border border-red-200 transition-colors"
                          >
                            Remove
                          </button>
                        </div>
                      ) : (
                        <div className="space-y-1.5">
                          <Paperclip className="w-6 h-6 text-slate-400 mx-auto" />
                          <p className="text-xs font-semibold text-slate-700">Drag & drop context file here, or click to browse</p>
                          <p className="text-[10px] text-slate-400">All file formats supported, including archives & documents (Max 50MB)</p>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex justify-end gap-3 pt-3 border-t border-slate-100">
                    <button
                      type="button"
                      onClick={() => setShowTaskModal(false)}
                      className="px-4 py-2 border border-slate-200 rounded-xl text-slate-500 hover:bg-slate-50 text-xs font-semibold transition-all"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={taskLoading}
                      className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-xl shadow-md transition-all flex items-center gap-1.5 disabled:opacity-50"
                    >
                      {taskLoading ? "Assigning..." : "Assign Task & Notify"}
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

/* SUBCOMPONENT: TaskCard */
interface TaskCardProps {
  key?: string;
  task: Task;
  project: Project;
  employees: Employee[];
  onStatusChange: (
    task: Task, 
    newStatus: Task['status'], 
    extra?: { rejectionNotes?: string; notDoneNotes?: string; completedRemarks?: string; completionAttachment?: TaskAttachment | null }
  ) => void;
  formatFileSize: (bytes: number) => string;
  currentUser: Employee;
}

function TaskCard({ task, project, employees, onStatusChange, formatFileSize, currentUser }: TaskCardProps) {
  const assignee = robustFindEmployee(employees, task.assignedTo);
  const creator = robustFindEmployee(employees, task.assignedBy);

  const [showRejectionForm, setShowRejectionForm] = useState(false);
  const [rejectionNotesInput, setRejectionNotesInput] = useState("");
  const [showCompletionForm, setShowCompletionForm] = useState(false);
  const [completedRemarksInput, setCompletedRemarksInput] = useState("");
  const [completionAttachment, setCompletionAttachment] = useState<TaskAttachment | null>(null);
  const [isDoneDragOver, setIsDoneDragOver] = useState(false);
  const [showNotDoneForm, setShowNotDoneForm] = useState(false);
  const [notDoneNotesInput, setNotDoneNotesInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [showImagePopup, setShowImagePopup] = useState(false);
  const [showCompletionImagePopup, setShowCompletionImagePopup] = useState(false);
  const [isDescExpanded, setIsDescExpanded] = useState(false);

  const handleDoneFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processDoneFile(file);
    }
  };

  const processDoneFile = (file: File) => {
    setErrorMsg("");
    if (file.size > 50 * 1024 * 1024) {
      setErrorMsg("Proof file size is too large (Max limit is 50MB).");
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      if (event.target?.result) {
        setCompletionAttachment({
          name: file.name,
          type: file.type,
          size: file.size,
          data: event.target.result as string
        });
      }
    };
    reader.onerror = () => {
      setErrorMsg("Failed to read the file. Please try again.");
    };
    reader.readAsDataURL(file);
  };

  // Download logic for Base64 attachments
  const handleDownloadAttachment = downloadAttachment;

  const isCompleted = task.status === 'completed';
  const isAssignee = task.assignedTo === currentUser.phone;

  const handleAccept = async () => {
    setSubmitting(true);
    setErrorMsg("");
    try {
      await onStatusChange(task, 'in progress');
    } catch (err: any) {
      setErrorMsg("Failed to accept task.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleRejectSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rejectionNotesInput.trim()) {
      setErrorMsg("Please provide notes stating why you are rejecting the task.");
      return;
    }
    setSubmitting(true);
    setErrorMsg("");
    try {
      await onStatusChange(task, 'rejected', { rejectionNotes: rejectionNotesInput.trim() });
      setShowRejectionForm(false);
    } catch (err: any) {
      setErrorMsg("Failed to reject task.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDoneSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setErrorMsg("");
    try {
      await onStatusChange(task, 'completed', { 
        completedRemarks: completedRemarksInput.trim() || undefined,
        completionAttachment: completionAttachment
      });
      setShowCompletionForm(false);
    } catch (err: any) {
      setErrorMsg("Failed to complete task.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleNotDoneSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!notDoneNotesInput.trim()) {
      setErrorMsg("Please provide notes explaining why the task is not done.");
      return;
    }
    setSubmitting(true);
    setErrorMsg("");
    try {
      await onStatusChange(task, 'in progress', { notDoneNotes: notDoneNotesInput.trim() });
      setShowNotDoneForm(false);
    } catch (err: any) {
      setErrorMsg("Failed to save progress feedback.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={`p-4 rounded-xl border shadow-sm transition-all flex flex-col gap-3 group ${
      isCompleted 
        ? 'bg-emerald-50/20 border-slate-200/60 opacity-80' 
        : task.status === 'rejected'
          ? 'bg-red-50/20 border-red-200/60'
          : 'bg-white border-slate-200 hover:border-indigo-300'
    }`}>
      <div>
        <div className="flex justify-between items-start mb-2">
          <span className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-tight border ${
            task.status === 'assigned'
              ? 'bg-blue-50 text-blue-700 border-blue-100'
              : task.status === 'rejected'
                ? 'bg-red-50 text-red-700 border-red-100'
                : task.status === 'in progress'
                  ? 'bg-amber-50 text-amber-700 border-amber-100'
                  : 'bg-emerald-50 text-emerald-700 border-emerald-100'
          }`}>
            {task.status}
          </span>
          {task.attachment && (
            <span className="text-[10px] text-slate-400 font-semibold flex items-center gap-1">
              <Paperclip className="w-3 h-3" /> context
            </span>
          )}
        </div>

        <h4 className={`font-bold text-sm leading-snug transition-colors ${
          isCompleted 
            ? 'text-slate-400 line-through' 
            : 'text-slate-800 group-hover:text-indigo-600'
        }`}>
          {task.title}
        </h4>
        {task.description && ( <>
          <p className={`text-xs mt-1 leading-relaxed whitespace-pre-wrap ${
            isCompleted ? 'text-slate-400' : 'text-slate-500'
          } ${!isDescExpanded && 'line-clamp-3'}`}>
            {task.description} 
          </p> 
          {task.description.length > 150 && (
            <button onClick={() => setIsDescExpanded(!isDescExpanded)} className="text-[10px] font-bold text-indigo-600 hover:underline mt-1 flex items-center gap-1">
              {isDescExpanded ? 'Read Less' : 'Read More'}
              {isDescExpanded 
                ? <ChevronUp className="w-3 h-3" /> 
                : <ChevronDown className="w-3 h-3" />
              }
            </button>
          )}
          </>
        )}

        {/* Saved Feedback / Notes display block */}
        {task.rejectionNotes && (
          <div className="mt-2.5 p-2 bg-red-50 border border-red-100/60 rounded-lg text-[11px] text-red-700">
            <span className="font-bold text-[9px] uppercase tracking-wider block text-red-500 mb-0.5">Rejection Reason:</span>
            <p className="font-medium">{task.rejectionNotes}</p>
          </div>
        )}

        {task.notDoneNotes && (
          <div className="mt-2.5 p-2 bg-amber-50 border border-amber-100/60 rounded-lg text-[11px] text-amber-700">
            <span className="font-bold text-[9px] uppercase tracking-wider block text-amber-500 mb-0.5">Status Update (Not Done):</span>
            <p className="font-medium">{task.notDoneNotes}</p>
          </div>
        )}

        {task.completedRemarks && (
          <div className="mt-2.5 p-2 bg-emerald-50 border border-emerald-100/60 rounded-lg text-[11px] text-emerald-700">
            <span className="font-bold text-[9px] uppercase tracking-wider block text-emerald-500 mb-0.5">Completion Notes:</span>
            <p className="font-medium">{task.completedRemarks}</p>
          </div>
        )}
      </div>

      {/* Attachment area inside card */}
      {task.attachment && !(task.status === 'completed' && task.completionAttachment) && (() => {
        const isImage = task.attachment.type?.startsWith('image/') || /\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(task.attachment.name || '');
        return (
          <>
            <div 
              onClick={() => {
                if (isImage) {
                  setShowImagePopup(true);
                } else {
                  handleDownloadAttachment(task.attachment!);
                }
              }}
              className="flex items-center justify-between bg-white hover:bg-indigo-50/50 border border-slate-200 hover:border-indigo-200 p-2 rounded-lg transition-all cursor-pointer text-left shrink-0 animate-fade-in"
              title={isImage ? "Click to view image in pop-up" : "Click to download attachment"}
            >
              <div className="flex items-center gap-2 overflow-hidden mr-1">
                {isImage ? (
                  <div className="w-6 h-6 rounded bg-indigo-50 flex items-center justify-center text-indigo-500 shrink-0 overflow-hidden border border-indigo-100">
                    <img src={task.attachment.data} alt="thumbnail" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                  </div>
                ) : (
                  <FileText className="w-4 h-4 text-indigo-500 shrink-0" />
                )}
                <div className="overflow-hidden">
                  <p className="text-[10px] font-semibold text-slate-700 truncate">{task.attachment.name}</p>
                  <p className="text-[8px] text-slate-400 font-mono">{formatFileSize(task.attachment.size)}</p>
                </div>
              </div>
              {isImage ? (
                <span className="text-[8px] font-bold text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded uppercase tracking-wide">View</span>
              ) : (
                <Download className="w-3.5 h-3.5 text-slate-400 group-hover:text-indigo-500 transition-colors shrink-0" />
              )}
            </div>

            {/* Image pop-up (lightbox modal) */}
            <AnimatePresence>
              {showImagePopup && (
                <div 
                  className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-sm"
                  onClick={() => setShowImagePopup(false)}
                >
                  <motion.div 
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className="relative z-10 bg-white rounded-2xl max-w-2xl w-full overflow-hidden shadow-2xl border border-slate-100 flex flex-col"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                      <div>
                        <h4 className="text-xs font-bold text-slate-800 truncate max-w-md">{task.attachment.name}</h4>
                        <p className="text-[9px] text-slate-400 font-mono">{formatFileSize(task.attachment.size)}</p>
                      </div>
                      <button 
                        type="button"
                        onClick={() => setShowImagePopup(false)}
                        className="p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                    
                    <div className="p-6 bg-slate-100 flex items-center justify-center max-h-[60vh] overflow-auto">
                      <img 
                        src={task.attachment.data} 
                        alt={task.attachment.name} 
                        className="max-h-[50vh] max-w-full object-contain rounded-lg shadow-sm"
                        referrerPolicy="no-referrer"
                      />
                    </div>

                    <div className="p-4 border-t border-slate-100 bg-white flex justify-end gap-2.5">
                      <button
                        type="button"
                        onClick={() => setShowImagePopup(false)}
                        className="px-4 py-1.5 border border-slate-200 text-slate-500 hover:bg-slate-50 rounded-xl text-xs font-semibold transition-all"
                      >
                        Close
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDownloadAttachment(task.attachment!)}
                        className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold transition-all flex items-center gap-1.5 shadow-sm"
                      >
                        <Download className="w-3.5 h-3.5" />
                        Download Image (Optional)
                      </button>
                    </div>
                  </motion.div>
                </div>
              )}
            </AnimatePresence>
          </>
        );
      })()}

      {/* Proof of Completion Attachment inside card */}
      {task.completionAttachment && (() => {
        const isImage = task.completionAttachment.type?.startsWith('image/') || /\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(task.completionAttachment.name || '');
        return (
          <div className="mt-1">
            <span className="text-[9px] font-bold text-emerald-600 uppercase tracking-wider block mb-1">Completion Proof:</span>
            <div 
              onClick={() => {
                if (isImage) {
                  setShowCompletionImagePopup(true);
                } else {
                  handleDownloadAttachment(task.completionAttachment!);
                }
              }}
              className="flex items-center justify-between bg-emerald-50/40 hover:bg-emerald-50 border border-emerald-200 hover:border-emerald-300 p-2 rounded-lg transition-all cursor-pointer text-left shrink-0 animate-fade-in"
              title={isImage ? "Click to view image in pop-up" : "Click to download proof"}
            >
              <div className="flex items-center gap-2 overflow-hidden mr-1">
                {isImage ? (
                  <div className="w-6 h-6 rounded bg-emerald-100/50 flex items-center justify-center text-emerald-600 shrink-0 overflow-hidden border border-emerald-200">
                    <img src={task.completionAttachment.data} alt="completion proof" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                  </div>
                ) : (
                  <FileText className="w-4 h-4 text-emerald-600 shrink-0" />
                )}
                <div className="overflow-hidden">
                  <p className="text-[10px] font-semibold text-emerald-800 truncate">{task.completionAttachment.name}</p>
                  <p className="text-[8px] text-emerald-500 font-mono">{formatFileSize(task.completionAttachment.size)}</p>
                </div>
              </div>
              {isImage ? (
                <span className="text-[8px] font-bold text-emerald-700 bg-emerald-100/50 px-1.5 py-0.5 rounded uppercase tracking-wide">View</span>
              ) : (
                <Download className="w-3.5 h-3.5 text-emerald-500 hover:text-emerald-700 transition-colors shrink-0" />
              )}
            </div>

            {/* Image pop-up (lightbox modal) */}
            <AnimatePresence>
              {showCompletionImagePopup && (
                <div 
                  className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-sm"
                  onClick={() => setShowCompletionImagePopup(false)}
                >
                  <motion.div 
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className="relative z-10 bg-white rounded-2xl max-w-2xl w-full overflow-hidden shadow-2xl border border-slate-100 flex flex-col"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                      <div>
                        <h4 className="text-xs font-bold text-slate-800 truncate max-w-md">{task.completionAttachment.name}</h4>
                        <p className="text-[9px] text-slate-400 font-mono">{formatFileSize(task.completionAttachment.size)}</p>
                      </div>
                      <button 
                        type="button"
                        onClick={() => setShowCompletionImagePopup(false)}
                        className="p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                    
                    <div className="p-6 bg-slate-100 flex items-center justify-center max-h-[60vh] overflow-auto">
                      <img 
                        src={task.completionAttachment.data} 
                        alt={task.completionAttachment.name} 
                        className="max-h-[50vh] max-w-full object-contain rounded-lg shadow-sm"
                        referrerPolicy="no-referrer"
                      />
                    </div>

                    <div className="p-4 border-t border-slate-100 bg-white flex justify-end gap-2.5">
                      <button
                        type="button"
                        onClick={() => setShowCompletionImagePopup(false)}
                        className="px-4 py-1.5 border border-slate-200 text-slate-500 hover:bg-slate-50 rounded-xl text-xs font-semibold transition-all"
                      >
                        Close
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDownloadAttachment(task.completionAttachment!)}
                        className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-semibold transition-all flex items-center gap-1.5 shadow-sm"
                      >
                        <Download className="w-3.5 h-3.5" />
                        Download Proof
                      </button>
                    </div>
                  </motion.div>
                </div>
              )}
            </AnimatePresence>
          </div>
        );
      })()}

      {/* Interactive Action Forms */}
      {showRejectionForm && (
        <form onSubmit={handleRejectSubmit} className="mt-2 p-3 bg-red-50 border border-red-100 rounded-lg space-y-2">
          <label className="block text-[10px] font-bold text-red-700 uppercase tracking-wider">Provide rejection reason *</label>
          <textarea
            required
            rows={2}
            value={rejectionNotesInput}
            onChange={(e) => setRejectionNotesInput(e.target.value)}
            placeholder="Why are you rejecting this task?"
            className="w-full p-2 border border-red-200 rounded bg-white text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-red-500 font-medium"
          />
          {errorMsg && <p className="text-[10px] text-red-600 font-bold">{errorMsg}</p>}
          <div className="flex justify-end gap-1.5">
            <button
              type="button"
              disabled={submitting}
              onClick={() => { setShowRejectionForm(false); setErrorMsg(""); }}
              className="px-2.5 py-1 text-[10px] font-bold text-slate-600 bg-white hover:bg-slate-100 border border-slate-200 rounded transition-colors uppercase tracking-wider"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-2.5 py-1 text-[10px] font-bold text-white bg-red-600 hover:bg-red-700 rounded transition-colors uppercase tracking-wider"
            >
              Confirm Reject
            </button>
          </div>
        </form>
      )}

      {showCompletionForm && (
        <form onSubmit={handleDoneSubmit} className="mt-2 p-3 bg-emerald-50 border border-emerald-100 rounded-lg space-y-2">
          <label className="block text-[10px] font-bold text-emerald-700 uppercase tracking-wider">Add completion remarks (Optional)</label>
          <textarea
            rows={2}
            value={completedRemarksInput}
            onChange={(e) => setCompletedRemarksInput(e.target.value)}
            placeholder="e.g. Completed layout, uploaded assets..."
            className="w-full p-2 border border-emerald-200 rounded bg-white text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-emerald-500 font-medium"
          />

          {/* Optional Completion Proof Attachment */}
          <div>
            <label className="block text-[10px] font-bold text-emerald-700 uppercase tracking-wider mb-1">Add Proof of Completion (Optional)</label>
            <div
              onDragOver={(e) => { e.preventDefault(); setIsDoneDragOver(true); }}
              onDragLeave={() => setIsDoneDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDoneDragOver(false);
                const file = e.dataTransfer.files?.[0];
                if (file) processDoneFile(file);
              }}
              onClick={() => document.getElementById(`completion-attachment-picker-${task.id}`)?.click()}
              className={`border border-dashed rounded p-2 text-center cursor-pointer transition-all ${
                isDoneDragOver ? 'border-emerald-500 bg-emerald-100/30' : 'border-emerald-200 hover:border-emerald-400 bg-white'
              }`}
            >
              <input
                type="file"
                id={`completion-attachment-picker-${task.id}`}
                className="hidden"
                onChange={handleDoneFileChange}
              />
              {completionAttachment ? (
                <div className="flex items-center justify-between text-left text-[11px] text-emerald-900 bg-emerald-100/30 p-1 rounded">
                  <span className="truncate font-semibold max-w-[200px]">{completionAttachment.name}</span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setCompletionAttachment(null);
                    }}
                    className="text-[10px] font-bold text-red-500 hover:text-red-700 ml-2"
                  >
                    Remove
                  </button>
                </div>
              ) : (
                <p className="text-[10px] text-slate-400">Click or drag completion proof file here</p>
              )}
            </div>
          </div>

          {errorMsg && <p className="text-[10px] text-red-600 font-bold">{errorMsg}</p>}
          <div className="flex justify-end gap-1.5">
            <button
              type="button"
              disabled={submitting}
              onClick={() => { setShowCompletionForm(false); setErrorMsg(""); setCompletionAttachment(null); }}
              className="px-2.5 py-1 text-[10px] font-bold text-slate-600 bg-white hover:bg-slate-100 border border-slate-200 rounded transition-colors uppercase tracking-wider"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-2.5 py-1 text-[10px] font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded transition-colors uppercase tracking-wider"
            >
              Submit as Done
            </button>
          </div>
        </form>
      )}

      {showNotDoneForm && (
        <form onSubmit={handleNotDoneSubmit} className="mt-2 p-3 bg-amber-50 border border-amber-100 rounded-lg space-y-2">
          <label className="block text-[10px] font-bold text-amber-700 uppercase tracking-wider">Why is this not done yet? *</label>
          <textarea
            required
            rows={2}
            value={notDoneNotesInput}
            onChange={(e) => setNotDoneNotesInput(e.target.value)}
            placeholder="Specify reason or roadblocks (e.g. waiting on API)..."
            className="w-full p-2 border border-amber-200 rounded bg-white text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-amber-500 font-medium"
          />
          {errorMsg && <p className="text-[10px] text-red-600 font-bold">{errorMsg}</p>}
          <div className="flex justify-end gap-1.5">
            <button
              type="button"
              disabled={submitting}
              onClick={() => { setShowNotDoneForm(false); setErrorMsg(""); }}
              className="px-2.5 py-1 text-[10px] font-bold text-slate-600 bg-white hover:bg-slate-100 border border-slate-200 rounded transition-colors uppercase tracking-wider"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-2.5 py-1 text-[10px] font-bold text-white bg-amber-600 hover:bg-amber-700 rounded transition-colors uppercase tracking-wider"
            >
              Submit Notes
            </button>
          </div>
        </form>
      )}

      <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2 shrink-0">
        <div>
          <span className="text-[9px] font-bold text-slate-400 block uppercase tracking-wider">Assignee</span>
          <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
            <span className={`w-1.5 h-1.5 rounded-full ${isCompleted ? 'bg-slate-300' : 'bg-indigo-500'}`}></span>
            {assignee ? assignee.name : "Unregistered Member"}
          </span>
          <span className="text-[9px] text-slate-400 font-mono block">{task.assignedTo}</span>
        </div>

        {/* Direct Action Buttons as requested - No Select Dropdowns! */}
        <div className="flex items-center gap-2 shrink-0">
          {isAssignee && !showRejectionForm && !showCompletionForm && !showNotDoneForm && (
            <>
              {task.status === 'assigned' && (
                <div className="flex gap-1.5">
                  <button
                    onClick={handleAccept}
                    disabled={submitting}
                    className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded text-[10px] font-bold uppercase tracking-wider transition-colors"
                  >
                    Accept
                  </button>
                  <button
                    onClick={() => setShowRejectionForm(true)}
                    disabled={submitting}
                    className="px-2.5 py-1 bg-white hover:bg-red-50 text-red-600 border border-red-200 rounded text-[10px] font-bold uppercase tracking-wider transition-colors"
                  >
                    Reject
                  </button>
                </div>
              )}

              {task.status === 'in progress' && (
                <div className="flex gap-1.5">
                  <button
                    onClick={() => setShowCompletionForm(true)}
                    disabled={submitting}
                    className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded text-[10px] font-bold uppercase tracking-wider transition-colors"
                  >
                    Done
                  </button>
                  <button
                    onClick={() => setShowNotDoneForm(true)}
                    disabled={submitting}
                    className="px-2.5 py-1 bg-white hover:bg-amber-50 text-amber-600 border border-amber-200 rounded text-[10px] font-bold uppercase tracking-wider transition-colors"
                  >
                    Not Done
                  </button>
                </div>
              )}
            </>
          )}

          {/* Plain Status Badge if not the assignee, or if status is completed/rejected */}
          {(!isAssignee || task.status === 'completed' || task.status === 'rejected') && (
            <span className={`px-2.5 py-1 rounded text-[10px] font-bold uppercase tracking-wider border ${
              task.status === 'assigned'
                ? 'bg-blue-50 text-blue-700 border-blue-100'
                : task.status === 'rejected'
                  ? 'bg-red-50 text-red-700 border-red-100'
                  : task.status === 'in progress'
                    ? 'bg-amber-50 text-amber-700 border-amber-100'
                    : 'bg-emerald-50 text-emerald-700 border-emerald-100'
            }`}>
              {task.status}
            </span>
          )}
        </div>
      </div>

      {/* Push Task / Delegate to another Employee */}
      {!isCompleted && (isAssignee || currentUser.role === 'admin') && (() => {
        const otherProjectMembers = employees.filter(emp => {
          if (emp.role !== 'employee' || emp.phone === task.assignedTo) {
            return false;
          }
          // Check if the employee is a member of the project by either email or phone
          return project.members.some(memberId => memberId.toLowerCase() === (emp.email || "").toLowerCase() || memberId === emp.phone);
        });
        if (otherProjectMembers.length === 0) return null; // Don't show if no one else is available

        return (
          <div className="mt-2.5 pt-2 border-t border-slate-100 flex items-center justify-between gap-1.5 animate-fade-in bg-slate-50/50 p-1.5 rounded-lg">
            <span className="text-[9px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1 shrink-0">
              <ArrowRightLeft className="w-3.5 h-3.5 text-indigo-500 shrink-0" /> Push Task:
            </span>
            <select
              onChange={async (e) => {
                const targetVal = e.target.value;
                if (!targetVal) return;
                if (window.confirm(`Are you sure you want to push/reassign this task?`)) {
                  try {
                    const response = await fetch(`/api/tasks/${task.id}/reassign`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        assignedTo: targetVal,
                        operatorPhone: currentUser.phone,
                        operatorName: currentUser.name
                      })
                    });
                    if (response.ok) {
                      // Trigger a state refresh in the parent ProjectBoard component
                      onStatusChange(task, task.status);
                    } else {
                      const errData = await response.json();
                      console.error("Failed to push task:", errData.error);
                    }
                  } catch (err) {
                    console.error("Network error. Failed to push task:", err);
                  }
                }
                e.target.value = ""; // reset dropdown
              }}
              className="px-2 py-1 bg-white border border-slate-200 hover:bg-slate-50 rounded text-[10px] font-bold text-indigo-600 focus:ring-1 focus:ring-indigo-500 max-w-[140px] cursor-pointer"
            >
              <option value="">Select Teammate...</option>
              {otherProjectMembers.map(emp => (
                  <option key={emp.phone} value={emp.phone}>{emp.name}</option>
                ))
              }
            </select>
          </div>
        );
      })()}

      <div className="text-[9px] text-slate-400 flex items-center justify-between mt-1 pt-1.5 border-t border-dashed border-slate-100">
        <span>By: {creator ? creator.name : "Admin"}</span>
        <span>{new Date(task.createdAt).toLocaleDateString()}</span>
      </div>
    </div>
  );
}

/* SUBCOMPONENT: SentTasksTrackerPanel */
interface SentTasksTrackerPanelProps {
  userTasks: Task[];
  currentUser: Employee;
  employees: Employee[];
  selectedProject?: Project;
  formatFileSize: (bytes: number) => string;
  onAddTask: () => void;
}

function SentTasksTrackerPanel({ userTasks, currentUser, employees, selectedProject, formatFileSize, onAddTask }: SentTasksTrackerPanelProps) {
  const assignedByMe = userTasks.filter(t => t.assignedBy === currentUser.phone);

  return (
    <div className="space-y-4">
      <div className="bg-purple-50/10 p-5 rounded-2xl border border-purple-100 min-h-[400px]">
        {assignedByMe.length === 0 ? (
          <div className="text-center py-20 bg-white rounded-xl border border-dashed border-slate-200">
            <FileText className="w-10 h-10 mx-auto text-slate-300 mb-2" />
            <p className="text-sm font-semibold text-slate-400">You haven't assigned any tasks yet.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {assignedByMe.map(t => {
              const assignee = robustFindEmployee(employees, t.assignedTo);
              return (
                <div key={t.id} className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm hover:border-purple-200 transition-all flex flex-col justify-between gap-4">
                  <div>
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <span className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider border ${
                        t.status === 'assigned'
                          ? 'bg-blue-50 text-blue-700 border-blue-100'
                          : t.status === 'rejected'
                            ? 'bg-red-50 text-red-700 border-red-100'
                            : t.status === 'in progress'
                              ? 'bg-amber-50 text-amber-700 border-amber-100'
                              : 'bg-emerald-50 text-emerald-700 border-emerald-100'
                      }`}>
                        {t.status}
                      </span>
                      <span className="text-[10px] text-slate-400 font-medium">
                        {new Date(t.createdAt).toLocaleDateString()}
                      </span>
                    </div>

                    <h4 className="font-bold text-sm text-slate-800 leading-snug">{t.title}</h4>
                    {t.description && (
                      <p className="text-xs text-slate-500 mt-1 line-clamp-2 leading-relaxed whitespace-pre-wrap">{t.description}</p>
                    )}

                    {/* Tracking Rejection, Roadblocks, or Completion feedback */}
                    {t.rejectionNotes && (
                      <div className="mt-3 p-2.5 bg-red-50 border border-red-100 rounded-lg text-xs text-red-700">
                        <span className="font-bold block text-[9px] uppercase tracking-wider text-red-500 mb-0.5">Rejection Reason:</span>
                        <p className="font-medium">{t.rejectionNotes}</p>
                      </div>
                    )}

                    {t.notDoneNotes && (
                      <div className="mt-3 p-2.5 bg-amber-50 border border-amber-100 rounded-lg text-xs text-amber-700">
                        <span className="font-bold block text-[9px] uppercase tracking-wider text-amber-500 mb-0.5">Teammate Update (Not Done):</span>
                        <p className="font-medium">{t.notDoneNotes}</p>
                      </div>
                    )}

                    {t.completedRemarks && (
                      <div className="mt-3 p-2.5 bg-emerald-50 border border-emerald-100 rounded-lg text-xs text-emerald-700">
                        <span className="font-bold block text-[9px] uppercase tracking-wider text-emerald-500 mb-0.5">Completion Notes:</span>
                        <p className="font-medium">{t.completedRemarks}</p>
                      </div>
                    )}

                    {/* Attachments inside tracker view */}
                    {(t.attachment || t.completionAttachment) && (
                      <div className="mt-3 flex flex-wrap gap-2 pt-2 border-t border-slate-100/60">
                        {t.attachment && (
                          <button
                            type="button"
                            onClick={() => downloadAttachment(t.attachment!)}
                            className="flex items-center gap-1.5 px-2.5 py-1 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg text-[10px] font-semibold text-slate-700 transition-all cursor-pointer"
                            title="Download context file"
                          >
                            <Paperclip className="w-3 h-3 text-slate-400" />
                            Context File
                          </button>
                        )}
                        {t.completionAttachment && (
                          <button
                            type="button"
                            onClick={() => downloadAttachment(t.completionAttachment!)}
                            className="flex items-center gap-1.5 px-2.5 py-1 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg text-[10px] font-bold text-emerald-800 transition-all cursor-pointer"
                            title="Download completion proof file"
                          >
                            <CheckCircle className="w-3 h-3 text-emerald-500" />
                            Completion Proof
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
                    <div>
                      <span className="text-[9px] font-bold text-slate-400 block uppercase tracking-wider">Assignee</span>
                      <span className="text-xs font-bold text-slate-700">{assignee ? assignee.name : "Unregistered Member"}</span>
                      <span className="text-[9px] text-slate-400 font-mono block">{t.assignedTo}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
