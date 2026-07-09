import React, { useState, useEffect } from "react";
import { Users, CheckCircle2, Clock, AlertCircle, BarChart3, TrendingUp, Sparkles } from "lucide-react";
import { Employee, Project, Task } from "../types";
import { subscribeAllTasks } from "../lib/firestoreService";

interface ProgressTrackerProps {
  currentUser: Employee;
  employees: Employee[];
  projects: Project[];
}

interface MemberMetric {
  employee: Employee;
  assigned: number;
  inProgress: number;
  completed: number;
  total: number;
  completionRate: number;
}

export default function ProgressTracker({ currentUser, employees, projects }: ProgressTrackerProps) {
  const [allTasks, setAllTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = subscribeAllTasks(currentUser.email || "", currentUser.role, (tasks) => {
      setAllTasks(tasks);
      setLoading(false);
    });
    return () => unsubscribe();
  }, [currentUser]);

  // Calculate project metrics
  const totalTasks = allTasks.length;
  const completedTasks = allTasks.filter(t => t.status === 'completed').length;
  const inProgressTasks = allTasks.filter(t => t.status === 'in progress').length;
  const assignedTasks = allTasks.filter(t => t.status === 'assigned').length;

  const overallCompletionRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  const currentUserEmailNorm = (currentUser.email || "").toLowerCase().trim();
  const isUserAdmin = currentUser.role === 'admin' || currentUserEmailNorm === 'mbmnmurali@gmail.com' || currentUserEmailNorm === 'innovalleyservices@gmail.com';

  // Calculate individual member metrics for real-time employee task loading
  const memberMetrics: MemberMetric[] = employees
    .filter(emp => emp.role !== "admin" && (emp.email || "").toLowerCase().trim() !== "innovalleyservices@gmail.com" && (emp.email || "").toLowerCase().trim() !== "mbmnmurali@gmail.com")
    .filter(emp => {
      if (isUserAdmin) return true;
      const empEmailNorm = (emp.email || "").toLowerCase().trim();
      return empEmailNorm === currentUserEmailNorm || emp.phone === currentUser.phone;
    })
    .map(emp => {
      const empEmailNorm = (emp.email || "").toLowerCase().trim();
      const empTasks = allTasks.filter(t => t.assignedTo && (t.assignedTo.toLowerCase().trim() === empEmailNorm || t.assignedTo === emp.phone));
      const assigned = empTasks.filter(t => t.status === 'assigned').length;
      const inProgress = empTasks.filter(t => t.status === 'in progress').length;
      const completed = empTasks.filter(t => t.status === 'completed').length;
      const total = empTasks.length;
      const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0;

      return {
        employee: emp,
        assigned,
        inProgress,
        completed,
        total,
        completionRate
      };
    }).sort((a, b) => b.completionRate - a.completionRate); // Sort by highest completion rate

  return (
    <div className="space-y-8 font-sans" id="progress-tracker-container">
      {/* Overview Stat Widgets */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-slate-400 text-xs font-bold uppercase tracking-widest">Total Tasks</span>
            <div className="p-1.5 bg-indigo-50 text-indigo-600 rounded-lg">
              <BarChart3 className="w-4 h-4" />
            </div>
          </div>
          <p className="text-3xl font-extrabold text-slate-800 mt-2 font-display">{totalTasks}</p>
        </div>

        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-slate-400 text-xs font-bold uppercase tracking-widest">Assigned</span>
            <div className="p-1.5 bg-slate-100 text-slate-600 rounded-lg">
              <AlertCircle className="w-4 h-4" />
            </div>
          </div>
          <p className="text-3xl font-extrabold text-slate-800 mt-2 font-display">{assignedTasks}</p>
        </div>

        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-slate-400 text-xs font-bold uppercase tracking-widest">In Progress</span>
            <div className="p-1.5 bg-indigo-50 text-indigo-600 rounded-lg">
              <Clock className="w-4 h-4" />
            </div>
          </div>
          <p className="text-3xl font-extrabold text-slate-800 mt-2 font-display">{inProgressTasks}</p>
        </div>

        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-slate-400 text-xs font-bold uppercase tracking-widest">Completed</span>
            <div className="p-1.5 bg-emerald-50 text-emerald-600 rounded-lg">
              <CheckCircle2 className="w-4 h-4" />
            </div>
          </div>
          <p className="text-3xl font-extrabold text-slate-800 mt-2 font-display">{completedTasks}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Aggregated Completion ring */}
        <div className="bg-white rounded-xl border border-slate-200 p-6 flex flex-col items-center justify-center text-center shadow-sm">
          <h3 className="font-bold text-slate-800 text-sm uppercase tracking-wider mb-4 w-full text-left font-display">Overall Completion Rate</h3>
          
          <div className="relative flex items-center justify-center w-40 h-40">
            {/* SVG circle meter */}
            <svg className="w-full h-full transform -rotate-90">
              <circle
                cx="80"
                cy="80"
                r="64"
                className="stroke-slate-100 fill-none"
                strokeWidth="10"
              />
              <circle
                cx="80"
                cy="80"
                r="64"
                className="stroke-indigo-600 fill-none transition-all duration-1000 ease-out"
                strokeWidth="10"
                strokeDasharray={`${2 * Math.PI * 64}`}
                strokeDashoffset={`${2 * Math.PI * 64 * (1 - overallCompletionRate / 100)}`}
                strokeLinecap="round"
              />
            </svg>
            <div className="absolute flex flex-col items-center">
              <span className="text-3xl font-extrabold text-slate-800 font-display">{overallCompletionRate}%</span>
              <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-1">Done</span>
            </div>
          </div>

          <div className="mt-6 flex items-center gap-1.5 text-xs text-indigo-700 bg-indigo-50 px-3 py-1.5 rounded-full font-semibold">
            <TrendingUp className="w-4 h-4" />
            <span>Real-time Sync Verified</span>
          </div>
        </div>

        {/* Real-time active project member loading list */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 p-6 shadow-sm flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-bold text-slate-800 text-lg font-display">
                {currentUser.role === 'admin' || currentUser.phone === '9848884897' ? "Active Project Members Progress" : "My Personal Progress Metrics"}
              </h3>
              <p className="text-xs text-slate-400">
                {currentUser.role === 'admin' || currentUser.phone === '9848884897' ? "Real-time status updates and loading levels per teammate" : "Your real-time task status updates and productivity tracking"}
              </p>
            </div>
            <Users className="w-5 h-5 text-slate-400 shrink-0" />
          </div>

          <div className="flex-1 overflow-y-auto divide-y divide-slate-100 pr-1 max-h-72">
            {memberMetrics.map(({ employee, assigned, inProgress, completed, total, completionRate }) => (
              <div key={employee.phone} className="py-4 first:pt-0 last:pb-0 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="h-9 w-9 bg-slate-100 border border-slate-200 rounded-full flex items-center justify-center text-xs font-extrabold text-slate-700">
                    {employee.name.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase()}
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
                      {employee.name}
                      {employee.role === 'admin' && (
                        <span className="text-[9px] bg-red-100 text-red-700 px-1.5 py-0.5 rounded-full font-bold">Admin</span>
                      )}
                    </h4>
                    <p className="text-xs text-slate-500 font-medium">{employee.designation}</p>
                    <p className="text-[10px] text-slate-400 font-mono">{employee.phone}</p>
                  </div>
                </div>

                <div className="flex items-center gap-4 w-full sm:w-auto shrink-0">
                  {/* Detailed stage indicators */}
                  <div className="flex gap-2 text-[10px] font-bold">
                    <span className="bg-blue-50 text-blue-600 border border-blue-100 px-1.5 py-0.5 rounded" title="Assigned">
                      {assigned} A
                    </span>
                    <span className="bg-amber-50 text-amber-600 border border-amber-100 px-1.5 py-0.5 rounded" title="In Progress">
                      {inProgress} IP
                    </span>
                    <span className="bg-emerald-50 text-emerald-600 border border-emerald-100 px-1.5 py-0.5 rounded" title="Completed">
                      {completed} C
                    </span>
                  </div>

                  {/* Horizontal progress bar */}
                  <div className="w-24 shrink-0">
                    <div className="flex items-center justify-between text-[10px] font-bold text-slate-500 mb-1">
                      <span>Rate</span>
                      <span className="text-slate-800">{completionRate}%</span>
                    </div>
                    <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden">
                      <div 
                        className="bg-emerald-500 h-full rounded-full transition-all duration-700" 
                        style={{ width: `${completionRate}%` }}
                      ></div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
