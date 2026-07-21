import React, { useState, useEffect, useRef } from "react";
import { Lock, AlertCircle, UserCheck } from "lucide-react";
import { motion } from "motion/react";
import { Employee } from "../types";
import { seedAdminUser } from "../lib/dbService";

interface LoginProps {
  onLoginSuccess: (user: Employee) => void;
}

export default function Login({ onLoginSuccess }: LoginProps) {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showAdminGuide, setShowAdminGuide] = useState(false);
  const [serverStatus, setServerStatus] = useState<'loading' | 'ok' | 'error'>('loading');

  useEffect(() => {
    const checkServerHealth = async () => {
      try {
        const res = await fetch("/api/health");
        if (res.ok) {
          setServerStatus('ok');
        } else {
          setServerStatus('error');
        }
      } catch (err) {
        setServerStatus('error');
      }
    };
    checkServerHealth();
    // Seed default admin first
    seedAdminUser().catch((err) => console.error("Error pre-seeding admin:", err));
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const inputVal = identifier.trim();
    const passVal = password.trim();

    if (!inputVal) {
      setError("Please enter your Email or Mobile Number.");
      setLoading(false);
      return;
    }
    if (!passVal) {
      setError("Please enter your 6-digit PIN.");
      setLoading(false);
      return;
    }

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          identifier: inputVal,
          password: passVal
        })
      });

      let data;
      try {
        data = await res.json();
      } catch (jsonErr) {
        throw new Error(`Server returned non-JSON response (${res.status} ${res.statusText || "Error"}).`);
      }

      if (res.ok && data.success && data.employee) {
        onLoginSuccess(data.employee);
      } else {
        setError(data.error || "Incorrect credentials.");
      }
    } catch (err: any) {
      console.error("Login error:", err);
      const errMsg = err?.message || String(err);
      setError(`Login failed: ${errMsg}. Please try again.`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center py-12 px-4 sm:px-6 lg:px-8 font-sans" id="login-container">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <h2 className="text-center text-3xl font-extrabold text-slate-900 tracking-tight font-display mb-1">
          Innovalley
        </h2>
        <p className="text-center text-sm font-semibold uppercase tracking-widest text-slate-500 font-display">
          workspace
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-8 px-6 shadow-xl rounded-2xl border border-slate-100 sm:px-10">
          {serverStatus === 'error' && (
            <motion.div 
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-4 bg-yellow-50 border border-yellow-200 text-yellow-800 p-3 rounded-lg flex items-start gap-2 text-sm"
            >
              <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
              <span>
                <strong>Server Connection Error</strong>
                <br />
                Could not connect to the backend server. Please make sure the server is running.
                Run <code>npm run dev</code> in your terminal.
              </span>
            </motion.div>
          )}
          {error && (
            <motion.div 
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-4 bg-red-50 border border-red-200 text-red-700 p-3 rounded-lg flex items-start gap-2 text-sm"
              id="login-error-banner"
            >
              <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
              <span>{error}</span>
            </motion.div>
          )}

          <form onSubmit={handleLogin} className="space-y-5">
            <div>
              <label htmlFor="identifier" className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-2">
                MOBILE NUMBER
              </label>
              <div className="relative rounded-lg shadow-sm">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
                </div>
                <input
                  type="tel"
                  id="identifier"
                  required
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={10}
                  placeholder="e.g. 9848884897"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value.replace(/[^0-9]/g, ""))}
                  className="block w-full pl-10 pr-3 py-3 border border-slate-200 bg-white rounded-xl text-slate-900 placeholder-slate-400 font-bold font-mono tracking-wider transition-all text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 focus:bg-indigo-50/10"
                />
              </div>
            </div>

            <div>
              <label htmlFor="password" className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-2">
                6-DIGIT PIN
              </label>
              <div className="relative rounded-lg shadow-sm">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                  <Lock className="h-5 w-5" />
                </div>
                <input
                  type="password"
                  id="password"
                  required
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  placeholder="Enter 6-digit PIN"
                  value={password}
                  onChange={(e) => setPassword(e.target.value.replace(/[^0-9]/g, ""))}
                  className="block w-full pl-10 pr-3 py-3 border border-slate-200 bg-white rounded-xl text-slate-900 placeholder-slate-400 font-bold font-mono tracking-widest transition-all text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 focus:bg-indigo-50/10"
                />
              </div>
            </div>

            <div>
              <button
                type="submit"
                disabled={loading || serverStatus !== 'ok'}
                id="sign-in-btn"
                className="w-full flex justify-center py-3 px-4 border border-transparent rounded-xl shadow-md text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 transition-colors cursor-pointer"
              >
                {loading ? "Verifying..." : "Sign In"}
              </button>
            </div>
          </form>


        </div>
      </div>
    </div>
  );
}
