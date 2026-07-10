import React, { useState, useEffect } from "react";
import { Lock, AlertCircle, UserCheck } from "lucide-react";
import { motion } from "motion/react";
import { Employee } from "../types";
import { seedAdminUser, setSessionToken } from "../lib/dbService";

interface LoginProps {
  onLoginSuccess: (user: Employee) => void;
}

export default function Login({ onLoginSuccess }: LoginProps) {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [captchaId, setCaptchaId] = useState("");
  const [captchaImage, setCaptchaImage] = useState("");
  const [captchaInput, setCaptchaInput] = useState("");
  const [captchaError, setCaptchaError] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // The server renders the captcha image itself and never sends the plaintext answer to
  // the client — verification happens purely server-side when the login form is submitted.
  const fetchCaptcha = async () => {
    setCaptchaError(false);
    try {
      const res = await fetch("/api/auth/captcha");
      if (res.ok) {
        const data = await res.json();
        setCaptchaId(data.captchaId);
        setCaptchaImage(data.image);
        setCaptchaInput("");
      } else {
        setCaptchaError(true);
      }
    } catch (err) {
      console.error("Error fetching captcha from server:", err);
      setCaptchaError(true);
    }
  };

  useEffect(() => {
    // Seed default admin first
    seedAdminUser().catch((err) => console.error("Error pre-seeding admin:", err));
    fetchCaptcha();
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const inputVal = identifier.trim();
    const passVal = password.trim();
    const capVal = captchaInput.trim().toUpperCase();

    if (!inputVal) {
      setError("Please enter your Email or Mobile Number.");
      setLoading(false);
      return;
    }
    if (!passVal) {
      setError("Please enter your password.");
      setLoading(false);
      return;
    }
    if (!captchaId || !capVal) {
      setError("Please enter the captcha verification code.");
      setLoading(false);
      return;
    }

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          identifier: inputVal,
          password: passVal,
          captchaId,
          captchaInput: capVal
        })
      });

      let data;
      try {
        data = await res.json();
      } catch (jsonErr) {
        throw new Error(`Server returned non-JSON response (${res.status} ${res.statusText || "Error"}).`);
      }

      if (res.ok && data.success && data.employee) {
        if (data.token) {
          setSessionToken(data.token);
        }
        onLoginSuccess(data.employee);
      } else {
        setError(data.error || "Incorrect credentials or captcha code.");
        // Always refresh captcha on failed login attempt
        fetchCaptcha();
      }
    } catch (err: any) {
      console.error("Login error:", err);
      const errMsg = err?.message || String(err);
      setError(`Login failed: ${errMsg}. Please try again.`);
      fetchCaptcha();
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
                EMAIL OR MOBILE NUMBER
              </label>
              <div className="relative rounded-lg shadow-sm">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                </div>
                <input
                  type="text"
                  id="identifier"
                  required
                  placeholder="e.g. innovalleyservices@gmail.com or 9848884897"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  className="block w-full pl-10 pr-3 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-slate-900 placeholder-slate-400 font-medium transition-all text-sm"
                />
              </div>
            </div>

            <div>
              <label htmlFor="password" className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-2">
                Password
              </label>
              <div className="relative rounded-lg shadow-sm">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                  <Lock className="h-5 w-5" />
                </div>
                <input
                  type="password"
                  id="password"
                  required
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="block w-full pl-10 pr-3 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-slate-900 placeholder-slate-400 font-medium transition-all text-sm"
                />
              </div>
            </div>

            {/* Captcha verification section */}
            <div className="space-y-2">
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1">
                Captcha Verification
              </label>
              <div className="grid grid-cols-2 gap-3 items-center">
                {/* Visual Captcha Block */}
                <div className="relative h-12 bg-slate-900 text-slate-200 rounded-xl flex items-center justify-center border border-slate-800 select-none overflow-hidden">
                  {captchaError ? (
                    <span className="text-[10px] text-red-300 px-2 text-center">Failed to load. Tap refresh.</span>
                  ) : captchaImage ? (
                    <img src={captchaImage} alt="Captcha" className="w-full h-full object-contain px-4" />
                  ) : (
                    <span className="text-[10px] text-slate-400">Loading...</span>
                  )}

                  {/* Absolute Refresh Button on Right */}
                  <button
                    type="button"
                    onClick={fetchCaptcha}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-200 hover:text-white bg-slate-900/80 p-1.5 rounded-lg border border-slate-800 hover:bg-slate-800 transition-colors"
                    title="Regenerate Captcha"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="animate-spin-slow">
                      <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
                      <path d="M3 3v5h5"/>
                      <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/>
                      <path d="M16 16h5v5"/>
                    </svg>
                  </button>
                </div>

                <input
                  type="text"
                  required
                  maxLength={4}
                  placeholder="Enter captcha"
                  value={captchaInput}
                  onChange={(e) => setCaptchaInput(e.target.value.replace(/[^A-Za-z0-9]/g, ""))}
                  className="h-12 w-full px-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-slate-900 placeholder-slate-400 font-bold font-mono tracking-wider text-center text-sm uppercase transition-all"
                />
              </div>
            </div>

            <div>
              <button
                type="submit"
                disabled={loading}
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
