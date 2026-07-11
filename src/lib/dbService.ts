import { Employee, Project, Task, EmailNotification, AuditLog, TaskAttachment } from "../types";
import { supabase } from "./supabaseClient";

// Helper to get current Supabase session token
const getAuthToken = async (): Promise<string | null> => {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token || null;
};

// authFetch: Automatically attach Supabase JWT to all API requests
const authFetch = async (url: string, options: RequestInit = {}) => {
  const token = await getAuthToken();
  const headers = new Headers(options.headers || {});
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(url, { ...options, headers });
};

// Subscribe to all employees with polling
export const subscribeEmployees = (callback: (employees: Employee[]) => void) => {
  const fetchEmployees = async () => {
    try {
      const res = await authFetch("/api/employees");
      if (res.ok) {
        const data = await res.json();
        callback(data);
      }
    } catch (e) {
      console.error("Error fetching employees:", e);
    }
  };

  fetchEmployees();
  const interval = setInterval(fetchEmployees, 4000);
  return () => clearInterval(interval);
};

// Add new employee (Admin action)
export const addEmployee = async (employee: Omit<Employee, 'id' | 'role'>) => {
  const res = await authFetch("/api/employees", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(employee)
  });
  return await res.json();
};

// Subscribe to projects with polling
export const subscribeProjects = (userEmail: string, userRole: 'admin' | 'employee', callback: (projects: Project[]) => void) => {
  const fetchProjects = async () => {
    try {
      const res = await authFetch(`/api/projects?userEmail=${encodeURIComponent(userEmail)}&role=${userRole}`);
      if (res.ok) {
        const data = await res.json();
        callback(data);
      }
    } catch (e) {
      console.error("Error fetching projects:", e);
    }
  };

  fetchProjects();
  const interval = setInterval(fetchProjects, 4000);
  return () => clearInterval(interval);
};

// Create a project (Admin action)
export const createProject = async (name: string, description: string, createdBy: string, members: string[]) => {
  const res = await authFetch("/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, description, createdBy, members })
  });
  return await res.json();
};

// Update project members
export const updateProjectMembers = async (projectId: string, members: string[]) => {
  const res = await authFetch(`/api/projects/${projectId}/members`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ members })
  });
  return await res.json();
};

// Delete a project
export const deleteProject = async (projectId: string) => {
  const res = await authFetch(`/api/projects/${projectId}`, { method: "DELETE" });
  return await res.json();
};

// Subscribe to tasks for a user
export const subscribeTasks = (userEmail: string, userPhone: string, callback: (tasks: Task[]) => void) => {
  const fetchTasks = async () => {
    try {
      const res = await authFetch(`/api/tasks?userEmail=${encodeURIComponent(userEmail)}&userPhone=${encodeURIComponent(userPhone)}`);
      if (res.ok) {
        const data = await res.json();
        callback(data);
      }
    } catch (e) {
      console.error("Error fetching tasks:", e);
    }
  };

  fetchTasks();
  const interval = setInterval(fetchTasks, 4000);
  return () => clearInterval(interval);
};

// Subscribe to all tasks (Admin)
export const subscribeAllTasks = (userEmail: string, userPhone: string, userRole: string, callback: (tasks: Task[]) => void) => {
  const fetchAllTasks = async () => {
    try {
      const res = await authFetch(`/api/tasks?userEmail=${encodeURIComponent(userEmail)}&userPhone=${encodeURIComponent(userPhone)}&role=${userRole}`);
      if (res.ok) {
        const data = await res.json();
        callback(data);
      }
    } catch (e) {
      console.error("Error fetching all tasks:", e);
    }
  };

  fetchAllTasks();
  const interval = setInterval(fetchAllTasks, 4000);
  return () => clearInterval(interval);
};

// Create a task
export const createTask = async (task: Omit<Task, 'id' | 'createdAt' | 'updatedAt'>) => {
  const res = await authFetch("/api/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(task)
  });
  return await res.json();
};

// Update task status
export const updateTaskStatus = async (taskId: string, status: string) => {
  const res = await authFetch(`/api/tasks/${taskId}/status`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status })
  });
  return await res.json();
};

// Update task
export const updateTask = async (taskId: string, updates: Partial<Task>) => {
  const res = await authFetch(`/api/tasks/${taskId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates)
  });
  return await res.json();
};

// Delete task
export const deleteTask = async (taskId: string) => {
  const res = await authFetch(`/api/tasks/${taskId}`, { method: "DELETE" });
  return await res.json();
};

// Delete completed tasks in a project
export const deleteCompletedTasks = async (projectId: string) => {
  const res = await authFetch(`/api/projects/${projectId}/tasks/completed`, { method: "DELETE" });
  return await res.json();
};

// Subscribe to notifications
export const subscribeNotifications = (callback: (notifications: EmailNotification[]) => void) => {
  const fetchNotifications = async () => {
    try {
      const res = await authFetch("/api/notifications");
      if (res.ok) {
        const data = await res.json();
        callback(data);
      }
    } catch (e) {
      console.error("Error fetching notifications:", e);
    }
  };

  fetchNotifications();
  const interval = setInterval(fetchNotifications, 5000);
  return () => clearInterval(interval);
};

// Subscribe to logs
export const subscribeLogs = (callback: (logs: AuditLog[]) => void) => {
  const fetchLogs = async () => {
    try {
      const res = await authFetch("/api/logs");
      if (res.ok) {
        const data = await res.json();
        callback(data);
      }
    } catch (e) {
      console.error("Error fetching logs:", e);
    }
  };

  fetchLogs();
  const interval = setInterval(fetchLogs, 5000);
  return () => clearInterval(interval);
};

// Update employee
export const updateEmployee = async (id: string, updates: Partial<Employee>) => {
  const res = await authFetch(`/api/employees/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates)
  });
  return await res.json();
};

// Delete employee
export const deleteEmployee = async (id: string) => {
  const res = await authFetch(`/api/employees/${id}`, { method: "DELETE" });
  return await res.json();
};
