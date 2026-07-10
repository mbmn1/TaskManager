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
  const [captchaId, setCaptchaId] = useState("");
  const [captchaText, setCaptchaText] = useState("");
  const [captchaInput, setCaptchaInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const fetchCaptcha = async () => {
    try {
      const res = await fetch("/api/auth/captcha");
      if (res.ok) {
        const data = await res.json();
        setCaptchaId(data.captchaId);
        setCaptchaText(data.captchaText);
        setCaptchaInput("");
      } else {
        generateLocalCaptcha();
      }
    } catch (err) {
      console.error("Error fetching captcha from server, falling back to local:", err);
      generateLocalCaptcha();
    }
  };

  const generateLocalCaptcha = () => {
    try {
      const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // clear alphanumeric chars
      let captchaTextStr = "";
      for (let i = 0; i < 4; i++) {
        captchaTextStr += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      setCaptchaId("local_captcha");
      setCaptchaText(captchaTextStr);
      setCaptchaInput("");
    } catch (err) {
      console.error("Error generating captcha locally:", err);
    }
  };

  useEffect(() => {
    if (captchaText && canvasRef.current) {
      const canvas = canvasRef.current;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        // Clear canvas
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Fill background with a dark slate color
        ctx.fillStyle = "#0f172a"; // Slate 900
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Draw random background grid and noisy dots
        for (let i = 0; i < 40; i++) {
          ctx.fillStyle = `rgba(${Math.floor(Math.random() * 255)}, ${Math.floor(Math.random() * 255)}, ${Math.floor(Math.random() * 255)}, 0.18)`;
          ctx.beginPath();
          ctx.arc(Math.random() * canvas.width, Math.random() * canvas.height, Math.random() * 2 + 1, 0, Math.PI * 2);
          ctx.fill();
        }

        // Draw random noise lines
        for (let i = 0; i < 4; i++) {
          ctx.strokeStyle = `rgba(${Math.floor(Math.random() * 100) + 150}, ${Math.floor(Math.random() * 100) + 150}, ${Math.floor(Math.random() * 100) + 150}, 0.4)`;
          ctx.lineWidth = Math.random() * 1.5 + 1;
          ctx.beginPath();
          ctx.moveTo(Math.random() * canvas.width, Math.random() * canvas.height);
          ctx.lineTo(Math.random() * canvas.width, Math.random() * canvas.height);
          ctx.stroke();
        }

        // Draw captcha letters with individual rotation and placement distortion
        ctx.font = "bold 20px 'JetBrains Mono', Courier, monospace";
        ctx.textBaseline = "middle";

        // Reserve 36px on the right for the absolute refresh button to prevent overlap
        const usableWidth = canvas.width - 36;
        const letterSpacing = usableWidth / (captchaText.length + 1);
        for (let i = 0; i < captchaText.length; i++) {
          const char = captchaText[i];
          const x = letterSpacing * (i + 1) + (Math.random() * 4 - 2);
          const y = canvas.height / 2 + (Math.random() * 4 - 2);
          
          // Apply randomized slight rotation
          const rotationAngle = (Math.random() * 30 - 15) * Math.PI / 180;

          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(rotationAngle);

          // Alternating bright aesthetic colors
          const colors = ["#818cf8", "#6366f1", "#4f46e5", "#38bdf8", "#34d399"];
          ctx.fillStyle = colors[i % colors.length];

          ctx.fillText(char, 0, 0);
          ctx.restore();
        }
      }
    }
  }, [captchaText]);

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
      setError("Please enter your Mobile Number.");
      setLoading(false);
      return;
    }
    if (!passVal) {
      setError("Please enter your password.");
      setLoading(false);
      return;
    }
    if (!capVal) {
      setError("Please enter the captcha verification code.");
      setLoading(false);
      return;
    }

    if (capVal !== captchaText) {
      setError("Incorrect captcha code. Please try again.");
      setLoading(false);
      fetchCaptcha();
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

      const data = await res.json();
      if (res.ok && data.success && data.employee) {
        onLoginSuccess(data.employee);
      } else {
        setError(data.error || "Incorrect credentials or captcha code.");
        // Always refresh captcha on failed login attempt
        fetchCaptcha();
      }
    } catch (err) {
      console.error("Login error:", err);
      setError("Server is starting or offline. Please try again.");
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
                MOBILE NUMBER
              </label>
              <div className="relative rounded-lg shadow-sm">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                </div>
                <input
                  type="text"
                  id="identifier"
                  required
                  placeholder="e.g. 9848884897 (without +91)"
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
                  <canvas 
                    ref={canvasRef} 
                    width={160} 
                    height={48} 
                    className="w-full h-full object-contain px-4" 
                  />
                  
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
