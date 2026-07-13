export interface Employee {
  id: string; // phone number (normalized)
  name: string;
  email: string;
  phone: string;
  designation: string;
  role: 'admin' | 'employee' | 'client';
  password?: string;
  trackAttendance?: boolean;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  createdBy: string; // admin's phone
  members: string[]; // list of employee phone numbers
  createdAt: number;
}

export interface TaskAttachment {
  name: string;
  type: string;
  size: number;
  data: string; // base64 Data URL
}

export interface Task {
  id: string;
  projectId: string;
  title: string;
  description: string;
  assignedTo: string; // employee phone number
  assignedBy: string; // creator phone number
  status: 'assigned' | 'rejected' | 'in progress' | 'completed';
  attachment?: TaskAttachment | null;
  completionAttachment?: TaskAttachment | null;
  rejectionNotes?: string;
  notDoneNotes?: string;
  completedRemarks?: string;
  createdAt: number;
  updatedAt: number;
}

export interface EmailNotification {
  id: string;
  toEmail: string;
  subject: string;
  body: string;
  timestamp: number;
  status: 'sent' | 'failed';
  taskTitle: string;
  projectId: string;
  projectName: string;
}

export interface AuditLog {
  id: string;
  projectId: string;
  projectName: string;
  action: string;
  details: string;
  operatorPhone: string;
  operatorName: string;
  timestamp: number;
}

