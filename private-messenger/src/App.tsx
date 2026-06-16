import { useState, useEffect, FormEvent } from "react";
import {
  onAuthStateChanged,
  signInWithPopup,
  GoogleAuthProvider,
  User as FirebaseUser,
} from "firebase/auth";
import {
  doc,
  getDoc,
  setDoc,
  collection,
  query,
  where,
  getDocs,
  onSnapshot,
  serverTimestamp,
} from "firebase/firestore";
import { motion, AnimatePresence } from "motion/react";
import {
  MessageSquare,
  Users,
  Bell,
  User,
  Settings,
  Shield,
  CornerDownRight,
  ChevronRight,
  Info,
} from "lucide-react";
import { auth, db, handleFirestoreError, OperationType } from "./firebase";
import { UserProfile, ViewType } from "./types";

// Inner views
import MessengerView from "./components/MessengerView";
import FriendsView from "./components/FriendsView";
import NotificationsView from "./components/NotificationsView";
import ProfileView from "./components/ProfileView";
import SettingsView from "./components/SettingsView";

export default function App() {
  const [currentUser, setCurrentUser] = useState<FirebaseUser | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  // Registration flow state
  const [needsRegistration, setNeedsRegistration] = useState(false);
  const [desiredUid, setDesiredUid] = useState("");
  const [desiredName, setDesiredName] = useState("");
  const [regError, setRegError] = useState("");
  const [regLoading, setRegLoading] = useState(false);

  // Active view layout navigation
  const [activeView, setActiveView] = useState<ViewType>("chats");
  const [unreadNotificationsCount, setUnreadNotificationsCount] = useState(0);

  // Deep linking targets from global notification clicks
  const [chatsInitialFriendId, setChatsInitialFriendId] = useState<string | undefined>(undefined);

  // Handle OAuth Sign-in State
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setCurrentUser(user);
      if (user) {
        // Authenticated! Check if profile exists
        try {
          setAuthError(null);
          const userDocRef = doc(db, "users", user.uid);
          const userSnap = await getDoc(userDocRef);

          if (userSnap.exists()) {
            setUserProfile({ id: userSnap.id, ...userSnap.data() } as UserProfile);
            setNeedsRegistration(false);
          } else {
            // New User! Redirect to setup
            setNeedsRegistration(true);
            setDesiredName(user.displayName || "");
            // Pre-seed UID from current display name
            const cleanedEmailPrefix = user.email?.split("@")[0].replace(/[^a-zA-Z0-9_\-]/g, "") || "";
            setDesiredUid(cleanedEmailPrefix.substring(0, 15).toUpperCase());
          }
        } catch (e) {
          console.error("Auth profile check failed:", e);
          setAuthError(e instanceof Error ? e.message : String(e));
        }
      } else {
        setUserProfile(null);
        setNeedsRegistration(false);
        setAuthError(null);
      }
      setLoading(false);
    });

    return unsubscribe;
  }, []);

  // Listen to unread notifications globally
  useEffect(() => {
    if (!currentUser?.uid || needsRegistration) return;

    const q = query(
      collection(db, "notifications"),
      where("userId", "==", currentUser.uid),
      where("read", "==", false)
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        setUnreadNotificationsCount(snapshot.size);
      },
      (error) => {
        console.error("Notifications counting failure:", error);
      }
    );

    return unsubscribe;
  }, [currentUser, needsRegistration]);

  // Google Login popup
  const handleGoogleLogin = async () => {
    setLoading(true);
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    try {
      await signInWithPopup(auth, provider);
    } catch (e) {
      console.error("Popup Authentication failed:", e);
      alert(
        "OAuth Popup was bypassed or blocked. If inside the AI Studio frame, please open the application in a new tab using the diagonal arrow icon on top right."
      );
      setLoading(false);
    }
  };

  // Profile registration click
  const handleCompleteRegistration = async (e: FormEvent) => {
    e.preventDefault();
    if (!currentUser) return;

    const formattedUid = desiredUid.trim().toLowerCase();
    const formattedName = desiredName.trim();

    if (formattedUid.length < 3 || formattedUid.length > 20) {
      setRegError("UID must be between 3 and 20 characters.");
      return;
    }

    if (!/^[a-zA-Z0-9_\-]+$/.test(formattedUid)) {
      setRegError("UID can only contain alphanumeric characters, underscores, or hyphens.");
      return;
    }

    if (!formattedName) {
      setRegError("Display Name cannot be empty.");
      return;
    }

    setRegError("");
    setRegLoading(true);

    try {
      // 1. Verify custom UID uniqueness
      const q = query(collection(db, "users"), where("uid", "==", formattedUid));
      const uidCheckSnapshot = await getDocs(q);

      if (!uidCheckSnapshot.empty) {
        setRegError("This simple UID is already taken by another user.");
        setRegLoading(false);
        return;
      }

      // 2. Write unique user profile
      const newProfile: UserProfile = {
        id: currentUser.uid,
        uid: formattedUid,
        displayName: formattedName,
        bio: "",
        photoURL: currentUser.photoURL || "",
        coverURL: "",
        createdAt: serverTimestamp(),
      };

      await setDoc(doc(db, "users", currentUser.uid), newProfile);

      setUserProfile(newProfile);
      setNeedsRegistration(false);
    } catch (e) {
      handleFirestoreError(e, OperationType.WRITE, `users/${currentUser.uid}`);
      setRegError("Database write failed. Try again.");
    } finally {
      setRegLoading(false);
    }
  };

  const handleLogout = () => {
    setCurrentUser(null);
    setUserProfile(null);
    setActiveView("chats");
  };

  // Universal Navigation target router
  const handleNavigateToView = (view: ViewType, targetUserId?: string) => {
    if (view === "chats" && targetUserId) {
      setChatsInitialFriendId(targetUserId);
    } else {
      setChatsInitialFriendId(undefined);
    }
    setActiveView(view);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center font-mono uppercase text-xs" id="app_startup_loading">
        <div className="space-y-2 text-center">
          <p className="tracking-[0.25em] text-white">Private Channel Booting...</p>
          <span className="text-zinc-600 text-[10px]">Verifying credentials</span>
        </div>
      </div>
    );
  }

  // 1. Google Login Screen (Zero Ads, Stark Minimalist Card Layout)
  if (!currentUser) {
    return (
      <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center p-6 selection:bg-white selection:text-black" id="auth_portal_layer">
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="max-w-md w-full border border-zinc-800 bg-zinc-950/40 p-8 text-center space-y-8 backdrop-blur-sm"
          id="auth_card"
        >
          {/* Stark Non-Branded Icon Symbol */}
          <div className="flex justify-center" id="auth_symbol">
            <Shield className="text-white w-12 h-12" />
          </div>

          <div className="space-y-2">
            <h1 className="text-sm font-mono tracking-[0.2em] text-white uppercase font-bold">
              Private Messenger
            </h1>
            <p className="text-xs text-zinc-500 uppercase font-mono max-w-xs mx-auto leading-relaxed">
              Strict peer-to-peer friend chat networks. No algorithms. No feeds. No public access.
            </p>
          </div>

          <div className="border-t border-b border-zinc-900 py-4 font-mono text-[10px] text-zinc-600 uppercase">
            <span>Encrypted Ledger Access Only</span>
          </div>

          <button
            id="google_auth_btn"
            onClick={handleGoogleLogin}
            className="w-full bg-white text-black hover:bg-zinc-200 py-3 text-xs uppercase font-mono font-bold tracking-widest transition-colors flex items-center justify-center gap-2 cursor-pointer"
          >
            Connect with Google
          </button>

          <p className="text-[9px] text-zinc-600 font-mono uppercase">
            Validated Sandbox environment. 2026-06-16T11:11
          </p>
        </motion.div>
      </div>
    );
  }

  // 2. Profile Claim Screen for New Sign-ups
  if (needsRegistration) {
    return (
      <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center p-6" id="registration_setup_layer">
        <motion.form
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          onSubmit={handleCompleteRegistration}
          className="max-w-md w-full border border-zinc-800 bg-zinc-950 p-8 space-y-6"
          id="registration_form"
        >
          <div className="text-center space-y-2">
            <h1 className="text-xs font-mono uppercase tracking-[0.2em] text-zinc-500 font-bold">
              Create Private Register
            </h1>
            <p className="text-xs text-white uppercase font-semibold">
              Claim Your Unique Identifiers
            </p>
          </div>

          <div className="space-y-4">
            <div>
              <label
                htmlFor="register_uid_input"
                className="text-xs font-mono uppercase tracking-wider text-zinc-500 mb-1 block"
              >
                Desired Alphanumeric UID
              </label>
              <input
                id="register_uid_input"
                type="text"
                className="w-full bg-zinc-950 border border-zinc-800 px-4 py-2.5 text-white font-mono text-sm uppercase placeholder-zinc-700 tracking-wider focus:outline-none focus:border-zinc-500"
                placeholder="E.G. CHRIS_V"
                value={desiredUid}
                onChange={(e) => setDesiredUid(e.target.value)}
                maxLength={20}
                required
              />
              <span className="text-[10px] font-mono text-zinc-650 mt-1 block uppercase">
                Friends use this exact code to search and add you.
              </span>
            </div>

            <div>
              <label
                htmlFor="register_name_input"
                className="text-xs font-mono uppercase tracking-wider text-zinc-500 mb-1 block"
              >
                Your Display Username
              </label>
              <input
                id="register_name_input"
                type="text"
                className="w-full bg-zinc-950 border border-zinc-800 px-4 py-2.5 text-white text-sm focus:outline-none focus:border-zinc-500"
                placeholder="E.G. Chris Vance"
                value={desiredName}
                onChange={(e) => setDesiredName(e.target.value)}
                maxLength={32}
                required
              />
            </div>

            {regError && (
              <p className="text-xs text-zinc-450 font-mono uppercase" id="register_error_alert">
                {regError}
              </p>
            )}

            <button
              id="register_claim_btn"
              type="submit"
              disabled={regLoading}
              className="w-full bg-white text-black py-3 text-xs uppercase font-mono font-bold tracking-widest transition-colors hover:bg-neutral-200 cursor-pointer"
            >
              {regLoading ? "Validating Claim..." : "Confirm Credentials"}
            </button>
          </div>
        </motion.form>
      </div>
    );
  }

  // If there's an Auth Error, show a friendly Retry / Troubleshooting rail
  if (authError && currentUser) {
    return (
      <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center p-6 select-none animate-fadeIn" id="auth_error_container">
        <div className="max-w-md w-full border border-red-900/60 bg-zinc-950 p-8 space-y-6 text-center">
          <div className="flex justify-center" id="auth_error_icon">
            <Shield className="text-red-500 w-12 h-12" />
          </div>
          <div className="space-y-2">
            <h1 className="text-xs font-mono uppercase tracking-[0.2em] text-red-500 font-bold">
              Secure Auth Handshake Failed
            </h1>
            <p className="text-xs text-zinc-400 font-mono leading-relaxed uppercase">
              The database rules block loading your user profile. The administrators are deploying safety rules updates.
            </p>
          </div>
          <div className="bg-black border border-zinc-900 p-4 font-mono text-[10px] text-zinc-500 text-left overflow-auto max-h-32 rounded">
            Error: {authError}
          </div>
          <div className="space-y-2 pt-2">
            <button
              id="auth_error_retry_btn"
              onClick={async () => {
                setLoading(true);
                setAuthError(null);
                try {
                  const userDocRef = doc(db, "users", currentUser.uid);
                  const userSnap = await getDoc(userDocRef);
                  if (userSnap.exists()) {
                    setUserProfile({ id: userSnap.id, ...userSnap.data() } as UserProfile);
                    setNeedsRegistration(false);
                  } else {
                    setNeedsRegistration(true);
                    setDesiredName(currentUser.displayName || "");
                    const cleanedEmailPrefix = currentUser.email?.split("@")[0].replace(/[^a-zA-Z0-9_\-]/g, "") || "";
                    setDesiredUid(cleanedEmailPrefix.substring(0, 15).toUpperCase());
                  }
                } catch (err) {
                  console.error("Retry failed:", err);
                  setAuthError(err instanceof Error ? err.message : String(err));
                } finally {
                  setLoading(false);
                }
              }}
              className="w-full bg-white text-black hover:bg-neutral-200 py-2.5 text-xs uppercase font-mono font-bold tracking-widest cursor-pointer transition-colors"
            >
              Retry Connection
            </button>
            <button
              id="auth_error_logout_btn"
              onClick={() => {
                auth.signOut();
                setCurrentUser(null);
                setUserProfile(null);
                setAuthError(null);
              }}
              className="w-full border border-zinc-800 text-zinc-400 hover:text-white py-2 text-xs uppercase font-mono tracking-widest cursor-pointer transition-colors"
            >
              Disconnect Identity
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Helper profile for loaded states safely guarded with fallback properties
  const activeProfile = userProfile || {
    id: currentUser?.uid || "unknown",
    uid: "loading...",
    displayName: currentUser?.displayName || "Member",
    bio: "",
    photoURL: currentUser?.photoURL || "",
    coverURL: "",
    createdAt: null,
  };

  // 3. Authenticated App Layout (Stark modern layout)
  return (
    <div className="min-h-screen bg-black text-white flex flex-col selection:bg-white selection:text-black font-sans" id="app_primary_canvas">
      {/* Upper Navigation Rail */}
      <header className="border-b border-zinc-800/80 bg-black py-4 px-6 relative z-10" id="global_header_bar">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-1.5 cursor-pointer" onClick={() => setActiveView("chats")}>
            <Shield className="text-white h-4 w-4" />
            <h1 className="text-xs tracking-[0.2em] font-mono uppercase font-bold text-white">
              Private Messenger
            </h1>
          </div>

          {/* Quick Stats Indicator Bar */}
          <div className="hidden sm:flex items-center gap-4 text-[10px] font-mono text-zinc-500 uppercase" id="header_status_indicators">
            <span>Identity: <strong className="text-white">{activeProfile.uid}</strong></span>
            <span>•</span>
            <span>Channel: <strong className="text-emerald-500">Secure Online</strong></span>
          </div>
        </div>
      </header>

      {/* Primary Contents Area */}
      <main className="flex-1 max-w-6xl w-full mx-auto p-4 md:p-6 overflow-hidden flex flex-col gap-6" id="app_content_scaffold">
        {/* Navigation Tabs (Chats, Friends, Notifications, Profile, Settings) */}
        <nav className="grid grid-cols-5 md:flex md:justify-center border border-zinc-800 bg-zinc-950 p-1 md:gap-2 uppercase font-mono text-[10px] tracking-wider" id="app_navigation_stripe">
          {/* Chats panel */}
          <button
            id="nav_chats_btn"
            onClick={() => handleNavigateToView("chats")}
            className={`py-2 px-1 text-center md:px-6 transition-all border flex flex-col md:flex-row items-center justify-center gap-1.5 cursor-pointer ${
              activeView === "chats"
                ? "bg-white text-black border-white"
                : "text-zinc-400 border-transparent hover:text-white"
            }`}
          >
            <MessageSquare size={13} />
            <span className="hidden sm:inline">Chats</span>
          </button>

          {/* Friends list panel */}
          <button
            id="nav_friends_btn"
            onClick={() => handleNavigateToView("friends")}
            className={`py-2 px-1 text-center md:px-6 transition-all border flex flex-col md:flex-row items-center justify-center gap-1.5 cursor-pointer ${
              activeView === "friends"
                ? "bg-white text-black border-white"
                : "text-zinc-400 border-transparent hover:text-white"
            }`}
          >
            <Users size={13} />
            <span className="hidden sm:inline">Friends</span>
          </button>

          {/* Notifications Log panel */}
          <button
            id="nav_notifications_btn"
            onClick={() => handleNavigateToView("notifications")}
            className={`py-2 px-1 text-center md:px-6 transition-all border flex flex-col md:flex-row items-center justify-center gap-1.5 relative cursor-pointer ${
              activeView === "notifications"
                ? "bg-white text-black border-white"
                : "text-zinc-400 border-transparent hover:text-white"
            }`}
          >
            <Bell size={13} />
            <span className="hidden sm:inline">Alerts</span>
            {unreadNotificationsCount > 0 && (
              <span className={`px-1.5 py-0.2 font-mono text-[8px] font-bold absolute -top-1 md:top-auto font-sans leading-relaxed ${
                activeView === "notifications" ? "bg-black text-white" : "bg-white text-black"
              }`}>
                {unreadNotificationsCount}
              </span>
            )}
          </button>

          {/* Profile page panel */}
          <button
            id="nav_profile_btn"
            onClick={() => handleNavigateToView("profile")}
            className={`py-2 px-1 text-center md:px-6 transition-all border flex flex-col md:flex-row items-center justify-center gap-1.5 cursor-pointer ${
              activeView === "profile"
                ? "bg-white text-black border-white"
                : "text-zinc-400 border-transparent hover:text-white"
            }`}
          >
            <User size={13} />
            <span className="hidden sm:inline">Profile</span>
          </button>

          {/* Settings panel */}
          <button
            id="nav_settings_btn"
            onClick={() => handleNavigateToView("settings")}
            className={`py-2 px-1 text-center md:px-6 transition-all border flex flex-col md:flex-row items-center justify-center gap-1.5 cursor-pointer ${
              activeView === "settings"
                ? "bg-white text-black border-white"
                : "text-zinc-400 border-transparent hover:text-white"
            }`}
          >
            <Settings size={13} />
            <span className="hidden sm:inline">Settings</span>
          </button>
        </nav>

        {/* View render with smooth fade-in motion animations */}
        <div className="flex-1 overflow-hidden" id="navigation_body_container">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeView}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="h-full overflow-y-auto"
              id={`view_render_${activeView}`}
            >
              {activeView === "chats" && (
                <MessengerView
                  currentUserProfile={activeProfile}
                  initialTargetFriendId={chatsInitialFriendId}
                />
              )}
              {activeView === "friends" && (
                <FriendsView
                  currentUserProfile={activeProfile}
                  onNavigateToChat={(id) => handleNavigateToView("chats", id)}
                />
              )}
              {activeView === "notifications" && (
                <NotificationsView onNavigateToView={handleNavigateToView} />
              )}
              {activeView === "profile" && (
                <ProfileView
                  currentUserProfile={activeProfile}
                  onProfileUpdated={(updated) => setUserProfile(updated)}
                />
              )}
              {activeView === "settings" && <SettingsView onLogout={handleLogout} />}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}
