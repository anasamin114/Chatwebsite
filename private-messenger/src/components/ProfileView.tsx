import { useState, ChangeEvent, DragEvent, FormEvent } from "react";
import { doc, updateDoc } from "firebase/firestore";
import { Camera, Copy, Check, Info, FileImage } from "lucide-react";
import { db, auth, handleFirestoreError, OperationType } from "../firebase";
import { UserProfile } from "../types";
import { compressImage } from "../utils/compressor";

interface ProfileViewProps {
  currentUserProfile: UserProfile;
  onProfileUpdated: (updatedProfile: UserProfile) => void;
}

export default function ProfileView({ currentUserProfile, onProfileUpdated }: ProfileViewProps) {
  const [displayName, setDisplayName] = useState(currentUserProfile.displayName);
  const [bio, setBio] = useState(currentUserProfile.bio || "");
  const [photoURL, setPhotoURL] = useState(currentUserProfile.photoURL || "");
  const [coverURL, setCoverURL] = useState(currentUserProfile.coverURL || "");

  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [copied, setCopied] = useState(false);

  // States for drop zones active feedback
  const [isAvatarDragActive, setIsAvatarDragActive] = useState(false);
  const [isCoverDragActive, setIsCoverDragActive] = useState(false);

  const myId = auth.currentUser?.uid;

  const handleCopyUid = () => {
    navigator.clipboard.writeText(currentUserProfile.uid);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Profile Photo processing
  const processAvatarFile = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      setErrorMsg("Must be an image file.");
      return;
    }
    try {
      setErrorMsg("");
      // Compress avatar to max 120x120 pixels to keep base64 extremely small
      const compressedB64 = await compressImage(file, 150, 150, 0.5);
      setPhotoURL(compressedB64);
    } catch (e) {
      setErrorMsg("Failed to process profile picture.");
    }
  };

  // Cover Image processing
  const processCoverFile = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      setErrorMsg("Must be an image file.");
      return;
    }
    try {
      setErrorMsg("");
      // Compress cover to 600x200 max to keep base64 extremely small
      const compressedB64 = await compressImage(file, 700, 250, 0.5);
      setCoverURL(compressedB64);
    } catch (e) {
      setErrorMsg("Failed to process cover picture.");
    }
  };

  // Avatar Selection Trigger
  const handleAvatarChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      processAvatarFile(e.target.files[0]);
    }
  };

  // Cover Selection Trigger
  const handleCoverChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      processCoverFile(e.target.files[0]);
    }
  };

  // Drag and Drop handlers
  const handleDragOver = (e: DragEvent, setDragActive: (active: boolean) => void) => {
    e.preventDefault();
    setDragActive(true);
  };

  const handleDragLeave = (e: DragEvent, setDragActive: (active: boolean) => void) => {
    e.preventDefault();
    setDragActive(false);
  };

  const handleDrop = (
    e: DragEvent,
    setDragActive: (active: boolean) => void,
    onProcess: (file: File) => void
  ) => {
    e.preventDefault();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      onProcess(e.dataTransfer.files[0]);
    }
  };

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    if (!myId) return;

    if (!displayName.trim()) {
      setErrorMsg("Name cannot be empty.");
      return;
    }

    setSaving(true);
    setSaveSuccess(false);
    setErrorMsg("");

    try {
      const userRef = doc(db, "users", myId);
      const updateData = {
        displayName: displayName.trim(),
        bio: bio.trim(),
        photoURL,
        coverURL,
      };

      await updateDoc(userRef, updateData);

      onProfileUpdated({
        ...currentUserProfile,
        ...updateData,
      });

      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (e) {
      handleFirestoreError(e, OperationType.WRITE, `users/${myId}`);
      setErrorMsg("Failed to update profile.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-xl mx-auto space-y-8" id="profile_view_container">
      <form onSubmit={handleSave} className="border border-zinc-800 bg-black overflow-hidden relative">
        {/* Cover Drag Drop Container */}
        <div
          className={`relative h-48 w-full transition-all border-b border-zinc-800 group ${
            coverURL ? "" : "bg-zinc-950"
          } ${isCoverDragActive ? "ring-2 ring-white scale-[0.99]" : ""}`}
          onDragOver={(e) => handleDragOver(e, setIsCoverDragActive)}
          onDragLeave={(e) => handleDragLeave(e, setIsCoverDragActive)}
          onDrop={(e) => handleDrop(e, setIsCoverDragActive, processCoverFile)}
          id="profile_cover_container"
        >
          {coverURL ? (
            <img
              src={coverURL}
              alt=""
              className="w-full h-full object-cover grayscale"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center border border-dashed border-zinc-900 text-zinc-550 font-mono text-xs uppercase p-4 text-center">
              <span className="mb-1">Drag Cover Image Here</span>
              <span className="text-[10px] text-zinc-650">Or use camera icon below</span>
            </div>
          )}

          {/* Absolute File picker trigger */}
          <label
            htmlFor="cover_file_picker"
            className="absolute bottom-4 right-4 bg-black/80 hover:bg-white hover:text-black border border-zinc-700 p-2 cursor-pointer transition-all flex items-center gap-1.5 text-[10px] font-mono text-white uppercase"
          >
            <Camera size={12} />
            <span>Select Cover</span>
            <input
              id="cover_file_picker"
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleCoverChange}
            />
          </label>
        </div>

        {/* Profile Details Header Context */}
        <div className="px-6 pb-6 relative" id="profile_meta_overlay">
          {/* Avatar Area with Floating Drag Drop */}
          <div className="flex items-end justify-between -mt-12 mb-6">
            <div
              className={`relative w-24 h-24 bg-black border-2 border-zinc-900 rounded-full shadow-md overflow-hidden group ${
                isAvatarDragActive ? "ring-2 ring-white scale-95" : ""
              }`}
              onDragOver={(e) => handleDragOver(e, setIsAvatarDragActive)}
              onDragLeave={(e) => handleDragLeave(e, setIsAvatarDragActive)}
              onDrop={(e) => handleDrop(e, setIsAvatarDragActive, processAvatarFile)}
              id="profile_avatar_dropzone"
            >
              {photoURL ? (
                <img
                  src={photoURL}
                  alt=""
                  className="w-full h-full object-cover grayscale"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center font-mono text-xs uppercase bg-zinc-900 border border-zinc-805 text-zinc-400">
                  {currentUserProfile.displayName.substring(0, 2)}
                </div>
              )}

              {/* Picker Label Overlay on Hover/Focus */}
              <label
                htmlFor="avatar_file_picker"
                className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center text-white cursor-pointer"
                title="Select Photo"
              >
                <Camera size={16} />
                <span className="text-[8px] font-mono uppercase mt-1">Photo</span>
                <input
                  id="avatar_file_picker"
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleAvatarChange}
                />
              </label>
            </div>

            {/* Unchangeable Custom UID Module */}
            <div className="text-right" id="profile_uid_card">
              <span className="text-[10px] uppercase font-mono tracking-widest text-zinc-500 block">
                Your Public UID
              </span>
              <div className="flex items-center gap-1 mt-1 justify-end">
                <span className="font-mono text-sm uppercase font-bold text-white tracking-wide">
                  {currentUserProfile.uid}
                </span>
                <button
                  type="button"
                  id="copy_profile_uid_btn"
                  onClick={handleCopyUid}
                  className="text-zinc-500 hover:text-white transition-colors cursor-pointer"
                  title="Copy UID"
                >
                  {copied ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
                </button>
              </div>
            </div>
          </div>

          {/* Form Fields */}
          <div className="space-y-4" id="profile_editing_form">
            <div>
              <label
                htmlFor="profile_display_name"
                className="text-xs font-mono uppercase tracking-widest text-zinc-500 mb-1.5 block font-bold"
              >
                Display Name
              </label>
              <input
                id="profile_display_name"
                type="text"
                className="w-full bg-zinc-950 border border-zinc-800 px-4 py-2.5 text-white text-sm uppercase tracking-wide focus:outline-none focus:border-zinc-500 rounded-sm"
                placeholder="Enter display name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                maxLength={64}
                required
              />
            </div>

            <div>
              <label
                htmlFor="profile_bio"
                className="text-xs font-mono uppercase tracking-widest text-zinc-500 mb-1.5 block font-bold"
              >
                Bio Description
              </label>
              <textarea
                id="profile_bio"
                className="w-full bg-zinc-950 border border-zinc-800 px-4 py-2.5 text-white text-sm h-24 resize-none leading-relaxed focus:outline-none focus:border-zinc-500 rounded-sm"
                placeholder="Write a brief private bio"
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                maxLength={300}
              />
              <p className="text-right text-[10px] font-mono text-zinc-650">
                {bio.length} / 300
              </p>
            </div>

            {errorMsg && (
              <p className="text-xs text-zinc-400 uppercase font-mono" id="profile_error_output">
                {errorMsg}
              </p>
            )}

            {saveSuccess && (
              <p className="text-xs text-white uppercase font-mono text-center tracking-wider py-1 bg-zinc-900 border border-zinc-805" id="profile_success_output">
                Profile Saved Successfully
              </p>
            )}

            {/* Direct Save Action Button */}
            <div className="pt-2">
              <button
                id="save_profile_btn"
                type="submit"
                disabled={saving}
                className="w-full bg-white text-black py-3 text-xs uppercase font-mono font-bold tracking-widest transition-all hover:bg-zinc-200 cursor-pointer"
              >
                {saving ? "Saving Changes..." : "Save Profile"}
              </button>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}
