import React, { useState, useEffect } from "react";
import { 
  Calendar, 
  Clock, 
  MapPin, 
  User, 
  FileText, 
  CheckCircle2, 
  AlertCircle, 
  Search, 
  Filter,
  ArrowRightLeft
} from "lucide-react";
import { Employee } from "../types";

interface AttendanceRecord {
  id: string;
  employee_id: string;
  employee_name: string;
  date: string;
  punch_in: string | null;
  punch_out: string | null;
  status: string;
  total_hours: string | null;
  notes: string;
}

interface AttendanceManagerProps {
  currentUser: Employee;
  employees: Employee[];
}

export default function AttendanceManager({ currentUser, employees }: AttendanceManagerProps) {
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [todayRecord, setTodayRecord] = useState<AttendanceRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Punch notes/remarks
  const [notesInput, setNotesInput] = useState("");

  // Filters for Admin
  const [filterEmployee, setFilterEmployee] = useState("");
  const [filterDate, setFilterDate] = useState("");

  const isAdmin = currentUser.role === "admin";

  // Get formatted date string YYYY-MM-DD
  const getTodayDateString = () => {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, "0");
    const dd = String(today.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  };

  // Get local current time string HH:MM:SS
  const getCurrentTimeString = () => {
    return new Date().toLocaleTimeString("en-US", { hour12: false });
  };

  // Fetch Attendance Records
  const fetchRecords = async () => {
    try {
      setLoading(true);
      setError(null);
      let url = "/api/attendance";
      
      // If employee, only load their own records
      if (!isAdmin) {
        url += `?employee_id=${currentUser.phone}`;
      }
      
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        setRecords(data);

        if (!isAdmin) {
          const todayStr = getTodayDateString();
          const todayRec = data.find((r: AttendanceRecord) => r.date === todayStr);
          if (todayRec) {
            setTodayRecord(todayRec);
          } else {
            setTodayRecord(null);
          }
        }
      } else {
        const errData = await res.json();
        setError(errData.error || "Failed to load attendance logs.");
      }
    } catch (err: any) {
      console.error("Error fetching attendance:", err);
      setError("Unable to connect to server.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRecords();
  }, [currentUser]);

  // Handle Punch In
  const handlePunchIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setLoading(true);

    const todayStr = getTodayDateString();
    const timeStr = getCurrentTimeString();

    try {
      const res = await fetch("/api/attendance/punch-in", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employee_id: currentUser.phone,
          employee_name: currentUser.name,
          date: todayStr,
          punch_in: timeStr,
          notes: notesInput
        })
      });

      const data = await res.json();
      if (res.ok) {
        setSuccess(`Punched in successfully at ${timeStr}`);
        setNotesInput("");
        await fetchRecords();
      } else {
        setError(data.error || "Failed to punch in.");
      }
    } catch (err: any) {
      setError("Server connection error during punch-in.");
    } finally {
      setLoading(false);
    }
  };

  // Handle Punch Out
  const handlePunchOut = async () => {
    setError(null);
    setSuccess(null);
    setLoading(true);

    const todayStr = getTodayDateString();
    const timeStr = getCurrentTimeString();

    // Calculate total hours if possible
    let totalHoursStr = "";
    if (todayRecord && todayRecord.punch_in) {
      try {
        const [h1, m1, s1] = todayRecord.punch_in.split(":").map(Number);
        const [h2, m2, s2] = timeStr.split(":").map(Number);
        const date1 = new Date(2000, 0, 1, h1, m1, s1);
        const date2 = new Date(2000, 0, 1, h2, m2, s2);
        const diffMs = date2.getTime() - date1.getTime();
        const diffHrs = Math.max(0, diffMs / (1000 * 60 * 60));
        totalHoursStr = `${diffHrs.toFixed(2)} hrs`;
      } catch (err) {
        console.error("Error calculating hours:", err);
      }
    }

    try {
      const res = await fetch("/api/attendance/punch-out", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employee_id: currentUser.phone,
          date: todayStr,
          punch_out: timeStr,
          total_hours: totalHoursStr
        })
      });

      const data = await res.json();
      if (res.ok) {
        setSuccess(`Punched out successfully at ${timeStr}. Total: ${totalHoursStr}`);
        await fetchRecords();
      } else {
        setError(data.error || "Failed to punch out.");
      }
    } catch (err: any) {
      setError("Server connection error during punch-out.");
    } finally {
      setLoading(false);
    }
  };

  // Filtered records for Admin
  const filteredRecords = records.filter(rec => {
    const matchEmp = !filterEmployee || rec.employee_id === filterEmployee || rec.employee_name.toLowerCase().includes(filterEmployee.toLowerCase());
    const matchDate = !filterDate || rec.date === filterDate;
    return matchEmp && matchDate;
  });

  return (
    <div className="space-y-6" id="attendance-section">
      
      {/* Notifications/Alert Banner */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-xl flex items-start gap-3 text-sm">
          <AlertCircle className="w-5 h-5 shrink-0 text-red-600 mt-0.5" />
          <div>
            <span className="font-bold">Error:</span> {error}
          </div>
        </div>
      )}

      {success && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 p-4 rounded-xl flex items-start gap-3 text-sm">
          <CheckCircle2 className="w-5 h-5 shrink-0 text-emerald-600 mt-0.5" />
          <div>
            <span className="font-bold">Success:</span> {success}
          </div>
        </div>
      )}

      {/* Main Grid: Employee Control Panel or Admin View */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Punch controls for employees whose attendance tracking is enabled */}
        {!isAdmin && (
          <div className="lg:col-span-1 bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-6">
            <div className="flex items-center gap-2.5 pb-4 border-b border-slate-100">
              <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg">
                <Clock className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-extrabold text-slate-900 font-display">Attendance Desk</h3>
                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Punch In & Punch Out</p>
              </div>
            </div>

            {/* Attendance tracking toggle warning */}
            {currentUser.trackAttendance === false ? (
              <div className="bg-amber-50 text-amber-800 p-3 rounded-xl text-xs font-semibold border border-amber-200">
                Attendance tracking is not required/enabled for your profile by the Administrator.
              </div>
            ) : (
              <div className="space-y-4">
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 text-center space-y-1">
                  <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest block">Today's Date</span>
                  <span className="text-sm font-extrabold text-slate-800 font-mono block">{getTodayDateString()}</span>
                  
                  {todayRecord ? (
                    <div className="pt-3 mt-3 border-t border-slate-200/60 grid grid-cols-2 gap-2 text-left">
                      <div>
                        <span className="text-[9px] text-slate-400 font-bold block uppercase">PUNCH IN</span>
                        <span className="text-xs font-bold text-emerald-600 font-mono">{todayRecord.punch_in}</span>
                      </div>
                      <div>
                        <span className="text-[9px] text-slate-400 font-bold block uppercase">PUNCH OUT</span>
                        <span className="text-xs font-bold text-slate-600 font-mono">{todayRecord.punch_out || "Active Session"}</span>
                      </div>
                    </div>
                  ) : (
                    <span className="text-xs text-slate-500 font-medium block pt-2">You haven't logged time for today yet.</span>
                  )}
                </div>

                {!todayRecord ? (
                  /* Punch In Form */
                  <form onSubmit={handlePunchIn} className="space-y-4">
                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                        Remarks / Notes (Optional)
                      </label>
                      <textarea
                        rows={2}
                        placeholder="Work from home, site visit, early shift notes..."
                        value={notesInput}
                        onChange={(e) => setNotesInput(e.target.value)}
                        className="w-full p-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 text-xs text-slate-800"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={loading}
                      className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold shadow-md transition-colors flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                    >
                      <MapPin className="w-4 h-4" /> Punch In Shift
                    </button>
                  </form>
                ) : !todayRecord.punch_out ? (
                  /* Punch Out Action */
                  <div className="space-y-3">
                    <button
                      type="button"
                      onClick={handlePunchOut}
                      disabled={loading}
                      className="w-full py-3 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold shadow-md transition-colors flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                    >
                      <Clock className="w-4 h-4" /> Punch Out Shift
                    </button>
                    <p className="text-[10px] text-slate-400 text-center font-semibold">
                      This will close today's workspace log session and calculate active duration.
                    </p>
                  </div>
                ) : (
                  /* Completed Today */
                  <div className="bg-emerald-50 border border-emerald-100 p-4 rounded-xl text-center space-y-1.5">
                    <CheckCircle2 className="w-6 h-6 text-emerald-500 mx-auto" />
                    <span className="text-xs font-bold text-emerald-800 block">Workspace Log Completed</span>
                    <span className="text-[10px] text-emerald-600 font-semibold block">
                      Total logged time: {todayRecord.total_hours}
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Attendance log search/filters for Admin */}
        {isAdmin && (
          <div className="lg:col-span-3 bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg">
                <Calendar className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-extrabold text-slate-900 font-display">Attendance Matrix Manager</h3>
                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Track clock times across full teams</p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
              {/* Employee Filter Dropdown */}
              <div className="flex-1 min-w-[160px] md:flex-none">
                <select
                  value={filterEmployee}
                  onChange={(e) => setFilterEmployee(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 text-xs font-semibold text-slate-700"
                >
                  <option value="">All Employees</option>
                  {employees
                    .filter(emp => emp.role === "employee")
                    .map(emp => (
                      <option key={emp.phone} value={emp.phone}>{emp.name}</option>
                    ))
                  }
                </select>
              </div>

              {/* Date Filter Input */}
              <div className="flex-1 min-w-[140px] md:flex-none">
                <input
                  type="date"
                  value={filterDate}
                  onChange={(e) => setFilterDate(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 text-xs font-semibold text-slate-700"
                />
              </div>

              {/* Clear Filter button */}
              {(filterEmployee || filterDate) && (
                <button
                  onClick={() => { setFilterEmployee(""); setFilterDate(""); }}
                  className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-bold rounded-xl transition-all cursor-pointer"
                >
                  Clear Filters
                </button>
              )}
            </div>
          </div>
        )}

        {/* History Table logs */}
        <div className={`${isAdmin ? 'lg:col-span-3' : 'lg:col-span-2'} bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4`}>
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">
              {isAdmin ? `All Work logs (${filteredRecords.length})` : "My Attendance History"}
            </h4>
            <span className="text-[10px] bg-slate-100 text-slate-500 font-bold px-2 py-0.5 rounded-full font-mono">
              Database Sync Active
            </span>
          </div>

          <div className="overflow-x-auto">
            {filteredRecords.length === 0 ? (
              <div className="text-center py-12 text-slate-400">
                <Clock className="w-8 h-8 mx-auto text-slate-300 mb-2 animate-pulse" />
                <p className="text-xs font-semibold">No attendance logs found in database.</p>
              </div>
            ) : (
              <table className="min-w-full divide-y divide-slate-100 text-left">
                <thead>
                  <tr className="text-[10px] font-bold text-slate-400 uppercase">
                    <th className="py-3 px-2">Date</th>
                    {isAdmin && <th className="py-3 px-3">Employee</th>}
                    <th className="py-3 px-3">In</th>
                    <th className="py-3 px-3">Out</th>
                    <th className="py-3 px-3">Duration</th>
                    <th className="py-3 px-3">Remarks / Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs text-slate-700 font-medium">
                  {filteredRecords.map((rec) => (
                    <tr key={rec.id} className="hover:bg-slate-50/50 transition-colors">
                      <td className="py-3 px-2 font-mono font-bold text-slate-800">{rec.date}</td>
                      {isAdmin && (
                        <td className="py-3 px-3">
                          <div className="flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full bg-emerald-500" />
                            <span className="font-semibold text-slate-900">{rec.employee_name}</span>
                          </div>
                        </td>
                      )}
                      <td className="py-3 px-3 font-mono text-emerald-600 font-bold">{rec.punch_in || "-"}</td>
                      <td className="py-3 px-3 font-mono text-slate-600 font-bold">{rec.punch_out || <span className="text-[10px] text-indigo-500 bg-indigo-50 px-1.5 py-0.5 rounded-md">In Shift</span>}</td>
                      <td className="py-3 px-3">
                        {rec.total_hours ? (
                          <span className="font-bold text-slate-800 bg-slate-100 px-2 py-0.5 rounded font-mono">
                            {rec.total_hours}
                          </span>
                        ) : (
                          <span className="text-slate-400">-</span>
                        )}
                      </td>
                      <td className="py-3 px-3 text-slate-500 italic max-w-xs truncate" title={rec.notes}>
                        {rec.notes || <span className="text-slate-300">No notes</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
