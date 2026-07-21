import { Employee, Project, Task, EmailNotification, AuditLog, TaskAttachment, Note } from "../types";

// Seed Admin user
export const seedAdminUser = async () => {
  try {
    const res = await fetch("/api/employees/seed", {
      method: "POST",
      headers: { "Content-Type": "application/json" }
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Server returned status ${res.status}: ${text}`);
    }
    return await res.json();
  } catch (error) {
    console.error("Error seeding admin user:", error);
  }
};

// Add new employee (Admin action)
export const addEmployee = async (employee: Omit<Employee, 'id'>) => {
  const res = await fetch("/api/employees", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(employee)
  });
  return await res.json();
};

// Create a project (Admin action)
export const createProject = async (name: string, description: string, createdBy: string, members: string[]) => {
  const res = await fetch("/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, description, createdBy, members })
  });
  return await res.json();
};

// Update project members
export const updateProjectMembers = async (projectId: string, members: string[]) => {
  const res = await fetch(`/api/projects/${projectId}/members`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ members })
  });
  return await res.json();
};

// Delete employee (Admin action)
export const deleteEmployee = async (phone: string) => {
  const res = await fetch(`/api/employees/${encodeURIComponent(phone)}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" }
  });
  return await res.json();
};

// Delete project (Admin action)
export const deleteProject = async (projectId: string) => {
  const res = await fetch(`/api/projects/${projectId}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" }
  });
  return await res.json();
};

// Delete completed tasks project-wise (Admin action)
export const deleteCompletedTasks = async (projectId: string) => {
  const res = await fetch(`/api/projects/${projectId}/tasks/cleanup`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" }
  });
  return await res.json();
};

// Update employee details (Admin action)
export const updateEmployee = async (phone: string, employee: Partial<Omit<Employee, 'id' | 'phone'>>) => {
  const res = await fetch(`/api/employees/${encodeURIComponent(phone)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(employee)
  });
  return await res.json();
};

// Update project details (Admin action)
export const updateProject = async (projectId: string, project: { name?: string, description?: string, members?: string[] }) => {
  const res = await fetch(`/api/projects/${projectId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(project)
  });
  return await res.json();
};

// Send automated notification helper
const sendAutomatedNotification = async (params: {
  toEmail: string;
  toName: string;
  taskTitle: string;
  projectName: string;
  updaterName: string;
  previousStatus?: string;
  newStatus: string;
  actionType: 'status_change' | 'assigned';
  description?: string;
  projectId: string;
  recipientRole?: 'admin' | 'employee' | 'client';
}) => {
  try {
    const response = await fetch("/api/notify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params)
    });

    if (response.ok) {
      const data = await response.json();
      if (data.success && data.notification) {
        // Record notification via API proxy
        await fetch("/api/notifications", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...data.notification,
            projectId: params.projectId,
            projectName: params.projectName,
            taskTitle: params.taskTitle
          })
        });
      }
    }
  } catch (err) {
    console.error("Failed to send notification via server api:", err);
  }
};

// Create a task and send automated email notification
export const createTask = async (task: Omit<Task, 'id' | 'createdAt' | 'updatedAt'>, project: Project, creator: Employee, assignee: Employee) => {
  const res = await fetch("/api/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ task, project, creator, assignee })
  });
  
  if (!res.ok) {
    throw new Error("Failed to create task on server.");
  }
  
  const createdTask = await res.json();

  // If self-assigned, don't send a notification
  if (assignee.phone === creator.phone) {
    return createdTask as Task;
  }


  // Trigger automated notification in the background
  sendAutomatedNotification({
    toEmail: assignee.email,
    toName: assignee.name,
    taskTitle: task.title,
    projectName: project.name,
    updaterName: creator.name,
    newStatus: 'assigned',
    actionType: 'assigned',
    description: task.description,
    projectId: project.id,
    recipientRole: assignee.role
  }).catch(err => {
    console.error("Background task assignment notification failed:", err);
  });

  return createdTask as Task;
};

// Update task status and trigger notification
export const updateTaskStatus = async (
  task: Task, 
  newStatus: 'assigned' | 'rejected' | 'in progress' | 'completed', 
  project: Project, 
  updater: Employee,
  assignee: Employee,
  extra?: {
    rejectionNotes?: string;
    notDoneNotes?: string;
    completedRemarks?: string;
    completionAttachment?: TaskAttachment | null;
  }
) => {
  const res = await fetch(`/api/tasks/${task.id}/status`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ 
      newStatus, 
      task, 
      project, 
      updater, 
      assignee,
      rejectionNotes: extra?.rejectionNotes,
      notDoneNotes: extra?.notDoneNotes,
      completedRemarks: extra?.completedRemarks,
      completionAttachment: extra?.completionAttachment
    })
  });

  if (!res.ok) {
    throw new Error("Failed to update task status on server.");
  }

  const previousStatus = task.status;

  // Fetch all employees to correctly identify roles for notifications
  const notificationEmails = new Set<string>();
  notificationEmails.add(assignee.email);
  let allEmployees: Employee[] = [];

  try {
    const empRes = await fetch("/api/employees");
    if (empRes.ok) {
      allEmployees = await empRes.json();
      allEmployees.forEach(emp => {
        if (emp.role === "admin" && emp.email) {
          notificationEmails.add(emp.email.trim().toLowerCase());
        }
      });
    }
  } catch (e) {
    allEmployees = [assignee, updater]; // Fallback to at least the involved users
    console.error("Error fetching admin emails for notifications:", e);
  }

  for (const email of Array.from(notificationEmails)) {
    const recipient = allEmployees.find(e => e.email && e.email.trim().toLowerCase() === email) || { name: "Administrator", role: 'admin' };
    sendAutomatedNotification({
      toEmail: email,
      toName: recipient.name,
      taskTitle: task.title,
      projectName: project.name,
      updaterName: updater.name,
      previousStatus,
      newStatus,
      actionType: 'status_change',
      description: `Status changed from ${previousStatus} to ${newStatus} by ${updater.name}`,
      projectId: project.id,
      recipientRole: recipient.role
    }).catch(err => {
      console.error(`Background status change notification failed for ${email}:`, err);
    });
  }
};

// Listen to project-wise audit logs (Admin action)
export const subscribeAuditLogs = (callback: (logs: AuditLog[]) => void) => {
  const fetchLogs = async () => { // Keep polling for logs as they are real-time critical
    try {
      const res = await fetch("/api/logs");
      if (res.ok) {
        const data = await res.json();
        callback(data);
      }
    } catch (e) {
      console.error("Error fetching audit logs:", e);
    }
  };
  fetchLogs();
  const interval = setInterval(fetchLogs, 3000);
  return () => clearInterval(interval);
};

// ========================================================================
// ON-DEMAND DATA FETCHING (Replaces Polling)
// ========================================================================

// Fetch all employees
export const fetchEmployees = async (): Promise<Employee[]> => {
  try {
    const res = await fetch("/api/employees");
    if (res.ok) {
      return await res.json();
    }
    return [];
  } catch (e) {
    console.error("Error fetching employees:", e);
    return [];
  }
};

// Fetch projects for the current user
export const fetchProjects = async (userEmail: string, userPhone: string, userRole: 'admin' | 'employee' | 'client'): Promise<Project[]> => {
  try {
    const res = await fetch(`/api/projects?userEmail=${encodeURIComponent(userEmail)}&userPhone=${encodeURIComponent(userPhone)}&role=${userRole}`);
    if (res.ok) {
      return await res.json();
    }
    return [];
  } catch (e) {
    console.error("Error fetching projects:", e);
    return [];
  }
};

// Fetch tasks for a specific project
export const fetchTasks = async (projectId: string, userEmail: string, userPhone: string, userRole: string): Promise<Task[]> => {
  try {
    const res = await fetch(`/api/tasks?projectId=${projectId}&userEmail=${encodeURIComponent(userEmail)}&userPhone=${encodeURIComponent(userPhone)}&role=${userRole}`);
    if (res.ok) {
      return await res.json();
    }
    return [];
  } catch (e) {
    console.error("Error fetching tasks:", e);
    return [];
  }
};

// Fetch all tasks (for admin/stats)
export const fetchAllTasks = async (userEmail: string, userPhone: string, userRole: string): Promise<Task[]> => {
  try {
    const res = await fetch(`/api/tasks?userEmail=${encodeURIComponent(userEmail)}&userPhone=${encodeURIComponent(userPhone)}&role=${userRole}`);
    if (res.ok) {
      return await res.json();
    }
    return [];
  } catch (e) {
    console.error("Error fetching all tasks:", e);
    return [];
  }
};

// Notes API
export const fetchNotes = async (employeeId: string): Promise<Note[]> => {
  const res = await fetch(`/api/notes?employee_id=${employeeId}`);
  return res.ok ? res.json() : [];
};

export const addNote = (note: Omit<Note, 'id' | 'createdAt' | 'updatedAt'>) => fetch("/api/notes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(note) }).then(res => res.json());

export const deleteNote = (noteId: string) => fetch(`/api/notes/${noteId}`, { method: "DELETE" }).then(res => res.json());

// ========================================================================
// REAL-TIME SUBSCRIPTIONS (For Notifications Only)
// ========================================================================

// Fetch all notifications
export const fetchNotifications = async (): Promise<EmailNotification[]> => {
  try {
    const res = await fetch("/api/notifications");
    return res.ok ? await res.json() : [];
  } catch (e) {
    console.error("Error fetching notifications:", e);
    return [];
  }
};

// Subscribe to notifications (keeps polling for real-time feel)
export const subscribeNotifications = (callback: (notifications: EmailNotification[]) => void) => {
  const fetchAndCallback = () => fetchNotifications().then(callback);
  fetchAndCallback();
  const interval = setInterval(fetchAndCallback, 5000); // Poll every 5 seconds
  return () => clearInterval(interval);
};
