import React, { useState, useEffect } from "react";
import { Mail, Lock, Sparkles, Shield, AlertCircle, Phone, Calculator } from "lucide-react";
import { motion } from "motion/react";
import { Employee } from "../types";
import { seedAdminUser } from "../lib/firestoreService";

interface LoginProps {
  onLoginSuccess: (user: Employee) => void;
}

export default function Login({ onLoginSuccess }: LoginProps) {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showSetupGuide, setShowSetupGuide] = useState(false);

  // Challenge modal states
  const [showChallengeModal, setShowChallengeModal] = useState(false);
  const [maskedEmail, setMaskedEmail] = useState("");
  const [emailAlphabetAnswer, setEmailAlphabetAnswer] = useState("");
  const [mathPuzzle, setMathPuzzle] = useState<{ num1: number; num2: number; op: string } | null>(null);
  const [mathAnswer, setMathAnswer] = useState("");
  const [generatedOtp, setGeneratedOtp] = useState<string | null>(null);
  const [phoneHint, setPhoneHint] = useState<string | null>(null);
  const [showBackupOtp, setShowBackupOtp] = useState(false);

  useEffect(() => {
    // Seed default admin first
    seedAdminUser().catch((err) => console.error("Error pre-seeding admin:", err));
  }, []);

  const handleSendChallenge = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const inputVal = identifier.trim();
    if (!inputVal) {
      setError("Please enter your Mobile Number or Admin Email.");
      setLoading(false);
      return;
    }

    const inputNormalized = inputVal.toLowerCase();

    // 1. Direct login for Sole Admin: innovalleyservices@gmail.com
    if (inputNormalized === "innovalleyservices@gmail.com") {
      if (!password) {
        setError("Please enter your administrator password.");
        setLoading(false);
        return;
      }

      try {
        const res = await fetch("/api/auth/verify-code", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ identifier: inputNormalized, password })
        });
        
        const data = await res.json();
        if (res.ok && data.success && data.employee) {
          onLoginSuccess(data.employee);
        } else {
          setError(data.error || "Incorrect password or credentials.");
        }
      } catch (err) {
        console.error("Admin login error:", err);
        setError("Database server is starting. Please try again in 5 seconds.");
      } finally {
        setLoading(false);
      }
      return;
    }

    // 2. Standard Mobile Number (Employee) Auth Challenge Flow
    try {
      const res = await fetch("/api/auth/send-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier: inputVal })
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setMaskedEmail(data.maskedEmail);
        setMathPuzzle(data.mathPuzzle);
        setGeneratedOtp(data.code);
        setPhoneHint(data.phone ? `******${data.phone.slice(-4)}` : "");
        
        // Reset inputs
        setEmailAlphabetAnswer("");
        setMathAnswer("");
        setOtp("");
        setShowBackupOtp(false);
        
        // Launch popup
        setShowChallengeModal(true);
      } else {
        setError(data.error || "This mobile number is not registered. Admin must add you first.");
      }
    } catch (err) {
      setError("Failed to connect to authentication server. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyChallenge = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const inputVal = identifier.trim();
    const payload = {
      identifier: inputVal,
      verificationType: showBackupOtp ? "otp" : "custom",
      emailAlphabetAnswer,
      mathAnswer,
      code: otp
    };

    try {
      const res = await fetch("/api/auth/verify-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (res.ok && data.success && data.employee) {
        setShowChallengeModal(false);
        onLoginSuccess(data.employee);
      } else {
        setError(data.error || "Incorrect security answers. Please verify and try again.");
      }
    } catch (err) {
      setError("Failed to verify credentials with server.");
    } finally {
      setLoading(false);
    }
  };

  const isEmailAdmin = identifier.trim().toLowerCase() === "innovalleyservices@gmail.com";

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center py-12 px-4 sm:px-6 lg:px-8 font-sans" id="login-container">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="flex justify-center mb-4">
          <div className="w-14 h-14 bg-indigo-600 rounded-2xl shadow-xl flex items-center justify-center text-white font-black text-2xl font-display">
            I
          </div>
        </div>
        <h2 className="text-center text-2xl font-extrabold text-slate-900 tracking-tight font-display">
          Innovalley Workspace Portal
        </h2>
        <p className="mt-1 text-center text-xs font-semibold text-slate-400 uppercase tracking-widest">
          Secure Mobile & Admin Access
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-8 px-6 shadow-xl rounded-2xl border border-slate-100 sm:px-10">
          {error && !showChallengeModal && (
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

          <form onSubmit={handleSendChallenge} className="space-y-6">
            <div>
              <label htmlFor="identifier" className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-2">
                Mobile Number or Admin Email
              </label>
              <div className="relative rounded-lg shadow-sm">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                  <Phone className="h-5 w-5" />
                </div>
                <input
                  type="text"
                  id="identifier"
                  required
                  placeholder="e.g. 7095472772 or admin email"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  className="block w-full pl-10 pr-3 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-slate-900 placeholder-slate-400 font-medium transition-all text-sm"
                />
              </div>
            </div>

            {isEmailAdmin && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                className="space-y-2"
              >
                <label htmlFor="password" className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1">
                  Administrator Password
                </label>
                <div className="relative rounded-lg shadow-sm">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                    <Lock className="h-5 w-5" />
                  </div>
                  <input
                    type="password"
                    id="password"
                    required
                    placeholder="Enter Mbmn@B!#!951"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="block w-full pl-10 pr-3 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-slate-900 placeholder-slate-400 font-medium transition-all text-sm"
                  />
                </div>
              </motion.div>
            )}

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

          {/* Setup Guide */}
          <div className="mt-6 pt-6 border-t border-slate-100">
            <button
              type="button"
              onClick={() => setShowSetupGuide(!showSetupGuide)}
              className="w-full text-center text-xs font-semibold text-indigo-600 hover:text-indigo-800 transition-colors flex items-center justify-center gap-1 cursor-pointer"
            >
              <Shield className="w-3.5 h-3.5" />
              {showSetupGuide ? "Hide Supabase Integration Guide" : "Want to connect to Supabase? Open Integration Guide"}
            </button>
            
            {showSetupGuide && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                className="mt-4 bg-slate-50 border border-slate-100 rounded-xl p-4 text-xs text-slate-600 space-y-3 leading-relaxed"
              >
                <p className="font-bold text-slate-800 text-[13px] flex items-center gap-1">
                  <Sparkles className="w-4 h-4 text-indigo-500" />
                  Connect Supabase Relational Database:
                </p>
                <p className="text-slate-600">
                  This workspace is 100% Supabase and Vercel ready! To direct all transactions to your production Supabase database:
                </p>
                <ol className="list-decimal list-inside space-y-2 text-slate-600 ml-1">
                  <li>
                    Create a new project on <a href="https://supabase.com" target="_blank" rel="noopener noreferrer" className="text-indigo-600 font-bold underline hover:text-indigo-800">Supabase</a>.
                  </li>
                  <li>
                    Configure these environment secrets in the Settings menu or your Vercel deployment:
                    <div className="bg-slate-100 p-2 rounded border border-slate-200 mt-1 font-mono text-[10px] text-slate-700 leading-normal border-dashed">
                      <div>VITE_SUPABASE_URL="https://your-proj.supabase.co"</div>
                      <div>VITE_SUPABASE_ANON_KEY="your-anon-key"</div>
                      <div>SUPABASE_URL="https://your-proj.supabase.co"</div>
                      <div>SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"</div>
                    </div>
                  </li>
                </ol>
              </motion.div>
            )}
          </div>
        </div>
      </div>

      {/* POP-UP VERIFICATION CHALLENGE MODAL */}
      {showChallengeModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fade-in" id="challenge-popup">
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="bg-white rounded-2xl shadow-2xl border border-slate-100 max-w-md w-full p-6 relative overflow-hidden"
          >
            <div className="flex items-center gap-2 mb-4">
              <div className="w-8 h-8 bg-indigo-100 rounded-lg flex items-center justify-center text-indigo-600">
                <Shield className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-950">Security Challenge</h3>
                <p className="text-[10px] text-slate-400 font-medium">Please verify ownership to sign in</p>
              </div>
            </div>

            {error && (
              <div className="mb-4 bg-red-50 border border-red-200 text-red-700 p-3 rounded-lg flex items-start gap-2 text-xs">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <form onSubmit={handleVerifyChallenge} className="space-y-4">
              {/* 1. Missing alphabets from email */}
              <div className="space-y-2">
                <label className="block text-[11px] font-bold text-slate-600 uppercase tracking-wider">
                  Email Alphabet Verification
                </label>
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 flex flex-col gap-2">
                  <div className="text-center font-mono text-sm font-black text-slate-800 tracking-wider">
                    {maskedEmail}
                  </div>
                  <p className="text-[10px] text-slate-400 text-center leading-normal">
                    Enter the missing letters replaced by asterisk (e.g. for <strong className="text-slate-600">**mnmu**li@gmail.com</strong> enter <strong className="text-indigo-600">mbmra</strong> or the full prefix/email)
                  </p>
                  <input
                    type="text"
                    required
                    placeholder="Enter the missing letters"
                    value={emailAlphabetAnswer}
                    onChange={(e) => setEmailAlphabetAnswer(e.target.value)}
                    className="block w-full px-3 py-2 border border-slate-200 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-slate-900 bg-white placeholder-slate-300 text-center text-xs font-bold transition-all rounded-lg"
                  />
                </div>
              </div>

              {/* 2. Math Puzzle */}
              {mathPuzzle && (
                <div className="space-y-2">
                  <label className="block text-[11px] font-bold text-slate-600 uppercase tracking-wider">
                    Solve Math Security Puzzle
                  </label>
                  <div className="bg-indigo-50/50 border border-indigo-100/50 rounded-xl p-3.5 flex items-center justify-between">
                    <span className="text-xs font-black text-indigo-950 font-mono">
                      {mathPuzzle.num1} {mathPuzzle.op === "*" ? "×" : mathPuzzle.op} {mathPuzzle.num2} = ?
                    </span>
                    <input
                      type="text"
                      required
                      placeholder="Answer"
                      value={mathAnswer}
                      onChange={(e) => setMathAnswer(e.target.value.replace(/[^0-9\-]/g, ""))}
                      className="w-24 px-2 py-2 border border-indigo-200 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white rounded-lg text-slate-900 placeholder-slate-300 text-center text-xs font-bold font-mono transition-all"
                    />
                  </div>
                </div>
              )}

              {/* Backdoor Backup OTP */}
              <div className="border border-slate-150 rounded-xl p-2.5 bg-slate-50/50">
                <button
                  type="button"
                  onClick={() => setShowBackupOtp(!showBackupOtp)}
                  className="w-full text-left text-[10px] text-slate-400 hover:text-slate-600 transition-colors flex items-center justify-between"
                >
                  <span>Need backup verification?</span>
                  <span className="font-bold">{showBackupOtp ? "Hide" : "Show Code"}</span>
                </button>
                {showBackupOtp && (
                  <div className="mt-2 pt-2 border-t border-slate-200 space-y-2">
                    <label className="block text-[10px] font-semibold text-slate-500">Backup 6-Digit OTP</label>
                    <input
                      type="text"
                      maxLength={6}
                      placeholder="Backup code"
                      value={otp}
                      onChange={(e) => setOtp(e.target.value.replace(/[^0-9]/g, ""))}
                      className="block w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-xs font-mono text-center font-bold tracking-widest bg-white"
                    />
                    <div className="p-2 bg-indigo-50 text-[9px] text-indigo-800 rounded border border-indigo-100/50 flex justify-between items-center leading-none">
                      <span>Verification Code:</span>
                      <strong className="font-mono select-all tracking-wider font-bold text-indigo-950">{generatedOtp || "123456"}</strong>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowChallengeModal(false)}
                  className="flex-1 py-2.5 border border-slate-200 rounded-xl text-slate-500 hover:bg-slate-50 text-xs font-semibold transition-all cursor-pointer text-center"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-xl shadow-md transition-all flex items-center justify-center disabled:opacity-50 cursor-pointer text-center"
                >
                  {loading ? "Verifying..." : "Verify & Log In"}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </div>
  );
}
