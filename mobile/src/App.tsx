import { useState, useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate, Outlet } from "react-router-dom";
import { useSystemColorScheme } from "@/hooks/useSystemColorScheme";
import { AuthProvider } from "@/contexts/AuthContext";
import { AppDataProvider } from "@/contexts/AppDataContext";
import { ToastProvider } from "@/components/ui/toast";
import { RequireAuth, RequireForcedChange, RequireGuest } from "@/routes/guards";
import { IdleGate } from "@/components/shell/IdleGate";
import { ShellLayout } from "@/components/shell/ShellLayout";
import { SplashScreen } from "@/components/shell/SplashScreen";

import Login from "@/pages/Login";
import UnsupportedRole from "@/pages/UnsupportedRole";
import ForcedPasswordChange from "@/pages/ForcedPasswordChange";
import ForgotPassword from "@/pages/ForgotPassword";
import ResetPassword from "@/pages/ResetPassword";

import Home from "@/pages/shell/Home";
import Roster from "@/pages/shell/Roster";
import Inbox from "@/pages/shell/Inbox";
import Profile from "@/pages/shell/Profile";

import AddPatient from "@/pages/AddPatient";
import EditPatient from "@/pages/EditPatient";
import PatientDetail from "@/pages/PatientDetail";
import LogIntervention from "@/pages/LogIntervention";
import ResubmitLog from "@/pages/ResubmitLog";
import ChangePasswordVoluntary from "@/pages/ChangePasswordVoluntary";
import ManageSignature from "@/pages/ManageSignature";
import EditContactInfo from "@/pages/EditContactInfo";

// Single shared instance of the auth/data/idle providers for every
// authenticated route (shell tabs and pushed views alike) — mounted once at
// the layout-route level so navigating between them never re-fetches
// patients/profile/stats or resets the idle timer's session start.
function AuthenticatedTree() {
  return (
    <RequireAuth>
      <AppDataProvider>
        <IdleGate>
          <Outlet />
        </IdleGate>
      </AppDataProvider>
    </RequireAuth>
  );
}

const SPLASH_SESSION_KEY = "izaya-splash-shown";

function App() {
  useSystemColorScheme();
  // Plays once per browser tab session — sessionStorage (not just in-memory
  // state) so a pull-to-refresh reload after login doesn't replay it; a
  // genuinely new session (tab/app fully closed and reopened) still gets it.
  // The route tree mounts underneath it immediately so the destination
  // screen is ready by the time the splash departs.
  const [showSplash, setShowSplash] = useState(() => {
    try {
      return sessionStorage.getItem(SPLASH_SESSION_KEY) !== "true";
    } catch {
      return true;
    }
  });

  useEffect(() => {
    if (showSplash) {
      try {
        sessionStorage.setItem(SPLASH_SESSION_KEY, "true");
      } catch {
        // Storage unavailable (private mode, etc.) — splash will just replay; harmless.
      }
    }
  }, [showSplash]);

  return (
    <BrowserRouter>
      {showSplash && <SplashScreen onFinish={() => setShowSplash(false)} />}
      <AuthProvider>
        <ToastProvider>
          <Routes>
            {/* Pre-auth stack — no tab bar */}
            <Route
              path="/login"
              element={
                <RequireGuest>
                  <Login />
                </RequireGuest>
              }
            />
            <Route
              path="/forgot-password"
              element={
                <RequireGuest>
                  <ForgotPassword />
                </RequireGuest>
              }
            />
            <Route
              path="/reset-password"
              element={
                <RequireGuest>
                  <ResetPassword />
                </RequireGuest>
              }
            />
            <Route path="/unsupported-role" element={<UnsupportedRole />} />
            <Route
              path="/change-password"
              element={
                <RequireForcedChange>
                  <ForcedPasswordChange />
                </RequireForcedChange>
              }
            />

            {/* Authenticated tree: one shared provider stack for the tab shell and every pushed view. */}
            <Route element={<AuthenticatedTree />}>
              {/* Bottom tab bar shell */}
              <Route element={<ShellLayout />}>
                <Route path="/home" element={<Home />} />
                <Route path="/roster" element={<Roster />} />
                <Route path="/inbox" element={<Inbox />} />
                <Route path="/profile" element={<Profile />} />
              </Route>

              {/* Pushed full-screen views — no tab bar */}
              <Route path="/patients/new" element={<AddPatient />} />
              <Route path="/patients/:id" element={<PatientDetail />} />
              <Route path="/patients/:id/edit" element={<EditPatient />} />
              <Route path="/patients/:id/log" element={<LogIntervention />} />
              <Route path="/inbox/:id/resubmit" element={<ResubmitLog />} />
              <Route path="/profile/change-password" element={<ChangePasswordVoluntary />} />
              <Route path="/profile/signature" element={<ManageSignature />} />
              <Route path="/profile/contact-info" element={<EditContactInfo />} />
            </Route>

            <Route path="/" element={<Navigate to="/login" replace />} />
            <Route path="*" element={<Navigate to="/login" replace />} />
          </Routes>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
