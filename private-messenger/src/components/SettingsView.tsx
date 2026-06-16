import { useState } from "react";
import { signOut } from "firebase/auth";
import { auth } from "../firebase";
import { Shield, LogOut, CheckSquare, Square, Info } from "lucide-react";

interface SettingsViewProps {
  onLogout: () => void;
}

export default function SettingsView({ onLogout }: SettingsViewProps) {
  // Simple layout toggles stored locally for UI preferences
  const [readReceipts, setReadReceipts] = useState(true);
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);

  const handleSignOut = async () => {
    if (!window.confirm("Are you sure you want to log out?")) return;
    try {
      await signOut(auth);
      onLogout();
    } catch (e) {
      console.error("Logout failed:", e);
    }
  };

  return (
    <div className="max-w-xl mx-auto space-y-6" id="settings_view_container">
      {/* 1. Protocol Notice Card */}
      <section className="border border-zinc-800 bg-black p-6" id="settings_privacy_notice">
        <div className="flex items-start gap-4">
          <Shield className="text-white mt-0.5 shrink-0" size={18} />
          <div>
            <h2 className="text-xs uppercase tracking-wider font-mono font-bold text-white">
              Private Chat Protocol
            </h2>
            <p className="mt-2 text-xs text-zinc-400 leading-relaxed uppercase font-mono">
              This channel is restricted. Only validated mutual connections can initiate private transmissions. There are no algorithms, public grids, feeds, or advertisements. Encryption integrity is verified with your alphanumeric UID.
            </p>
          </div>
        </div>
      </section>

      {/* 2. Preferences Form Area */}
      <section className="border border-zinc-800 bg-black p-6 space-y-6" id="settings_preferences_section">
        <h3 className="text-xs uppercase tracking-widest font-mono text-zinc-500 font-bold border-b border-zinc-900 pb-2">
          Preferences
        </h3>

        {/* Read Receipts */}
        <div
          onClick={() => setReadReceipts(!readReceipts)}
          className="flex items-center justify-between cursor-pointer py-1 group"
          id="toggle_read_receipts"
        >
          <div>
            <span className="text-sm font-medium text-white block">Read Receipts</span>
            <span className="text-[10px] font-mono text-zinc-500 uppercase">
              Let friends see when you read their message
            </span>
          </div>
          <div>
            {readReceipts ? (
              <CheckSquare size={18} className="text-white" />
            ) : (
              <Square size={18} className="text-zinc-800 group-hover:text-zinc-650" />
            )}
          </div>
        </div>

        {/* In-app Notifications Toggles */}
        <div
          onClick={() => setNotificationsEnabled(!notificationsEnabled)}
          className="flex items-center justify-between cursor-pointer py-1 group"
          id="toggle_in_app_notif"
        >
          <div>
            <span className="text-sm font-medium text-white block">Alert Notifications</span>
            <span className="text-[10px] font-mono text-zinc-500 uppercase">
              Receive live badges during active browser sessions
            </span>
          </div>
          <div>
            {notificationsEnabled ? (
              <CheckSquare size={18} className="text-white" />
            ) : (
              <Square size={18} className="text-zinc-800 group-hover:text-zinc-650" />
            )}
          </div>
        </div>
      </section>

      {/* 3. Session Controls */}
      <section className="border border-zinc-800 bg-black p-6" id="settings_session_section">
        <div className="flex items-center justify-between">
          <div>
            <span className="text-sm font-medium text-white block">Active Browser Session</span>
            <span className="text-[10px] font-mono text-zinc-500 uppercase">
              End transmission and sign out of this device
            </span>
          </div>
          <button
            id="logout_action_btn"
            onClick={handleSignOut}
            className="flex items-center gap-1.5 bg-zinc-900 border border-zinc-800 text-white hover:bg-zinc-850 px-4 py-2.5 font-mono text-xs uppercase cursor-pointer"
          >
            <LogOut size={14} />
            <span>Sign Out</span>
          </button>
        </div>
      </section>
    </div>
  );
}
