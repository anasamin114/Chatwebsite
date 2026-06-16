import { useState, useEffect, useRef, ChangeEvent, FormEvent } from "react";
import {
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  addDoc,
  setDoc,
  doc,
  updateDoc,
  serverTimestamp,
  writeBatch,
  getDocs,
} from "firebase/firestore";
import { Send, Image, Film, Smile, ArrowLeft, Eye, EyeOff, FileText, CheckCircle2, X } from "lucide-react";
import { db, auth, handleFirestoreError, OperationType } from "../firebase";
import { ChatMessage, UserProfile } from "../types";
import { compressImage, fileToBase64 } from "../utils/compressor";

interface ConversationViewProps {
  friendId: string;
  friendProfile: UserProfile;
  currentUserProfile: UserProfile;
  onBack: () => void;
}

const POPULAR_EMOJIS = [
  "😄", "😂", "🫠", "👍", "❤️", "🔥", "👀", "👀", "😮", "😢", "🎉", "🚀", "👏", "🤝", "💯", "💀"
];

export default function ConversationView({
  friendId,
  friendProfile,
  currentUserProfile,
  onBack,
}: ConversationViewProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState("");
  const [loading, setLoading] = useState(true);

  // Selector Drawer Toggles
  const [showEmojiGrid, setShowEmojiGrid] = useState(false);
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [mediaPreview, setMediaPreview] = useState<string | null>(null);
  const [mediaType, setMediaType] = useState<"image" | "video" | null>(null);
  const [attachmentError, setAttachmentError] = useState("");

  const conversationEndRef = useRef<HTMLDivElement>(null);
  const myId = auth.currentUser?.uid;

  // Bilateral conversation identifier matching Firestore rules schema
  const conversationId = myId
    ? myId < friendId
      ? `${myId}_${friendId}`
      : `${friendId}_${myId}`
    : "";

  // 1. Subscribe to messages in real-time
  useEffect(() => {
    if (!conversationId) return;

    setLoading(true);
    const q = query(
      collection(db, "messages"),
      where("conversationId", "==", conversationId),
      orderBy("createdAt", "asc")
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const list = snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as ChatMessage));
        setMessages(list);
        setLoading(false);

        // Scroll to newest message
        setTimeout(() => {
          conversationEndRef.current?.scrollIntoView({ behavior: "smooth" });
        }, 100);

        // 2. Mark incoming messages as read
        if (myId) {
          const unreadIncomingDocs = snapshot.docs.filter((doc) => {
            const data = doc.data();
            return data.receiverId === myId && data.read === false;
          });

          if (unreadIncomingDocs.length > 0) {
            const batch = writeBatch(db);
            unreadIncomingDocs.forEach((docSnap) => {
              batch.update(docSnap.ref, { read: true });
            });
            batch.commit().catch((e) => console.error("Failed to mark read receipts", e));
          }
        }
      },
      (error) => {
        handleFirestoreError(error, OperationType.GET, `messages/${conversationId}`);
        setLoading(false);
      }
    );

    return unsubscribe;
  }, [conversationId, myId]);

  // Handle custom media selections with type checks
  const handlePhotoSelect = async (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      if (!file.type.startsWith("image/")) {
        setAttachmentError("Requires image mime-type files.");
        return;
      }
      setAttachmentError("");
      try {
        setMediaType("image");
        setMediaFile(file);
        // Compress immediate preview
        const base64Preview = await compressImage(file, 450, 450, 0.5);
        setMediaPreview(base64Preview);
      } catch (err) {
        setAttachmentError("Compression failed.");
      }
    }
  };

  const handleVideoSelect = async (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      if (!file.type.startsWith("video/")) {
        setAttachmentError("Requires video mime-type files.");
        return;
      }
      // Check Firestore limit warning (under 300KB)
      if (file.size > 360000) {
        setAttachmentError("Lightweight chats: video must be under 350KB.");
        return;
      }
      setAttachmentError("");
      setMediaType("video");
      setMediaFile(file);
      try {
        const b64 = await fileToBase64(file);
        setMediaPreview(b64);
      } catch (err) {
        setAttachmentError("Unsupported encoding.");
      }
    }
  };

  const handleInsertEmoji = (emoji: string) => {
    setInputText((prev) => prev + emoji);
    setShowEmojiGrid(false);
  };

  const clearAttachment = () => {
    setMediaFile(null);
    setMediaPreview(null);
    setMediaType(null);
    setAttachmentError("");
  };

  // 3. Send Message Action
  const handleSendMessage = async (e: FormEvent) => {
    e.preventDefault();
    if (!myId || !currentUserProfile) return;

    const trimmedText = inputText.trim();
    if (!trimmedText && !mediaPreview) return;

    const isMedia = !!mediaPreview;
    const finalType = isMedia ? (mediaType === "video" ? "video" : "image") : "text";

    const payload = {
      conversationId,
      senderId: myId,
      receiverId: friendId,
      text: trimmedText,
      type: finalType,
      mediaUrl: mediaPreview || "",
      read: false,
      createdAt: serverTimestamp(),
    };

    // Reset Form Input immediately to ensure rapid UX feel
    setInputText("");
    clearAttachment();

    try {
      // Add message doc using autogenerated ID
      const msgRef = doc(collection(db, "messages"));
      const msgId = msgRef.id;

      await setDoc(doc(db, "messages", msgId), payload);

      // Create a direct receiver notification
      const notifId = doc(collection(db, "notifications")).id;
      await setDoc(doc(db, "notifications", notifId), {
        userId: friendId,
        type: "message",
        senderId: myId,
        senderName: currentUserProfile.displayName,
        senderUid: currentUserProfile.uid,
        read: false,
        createdAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `messages_add_failed`);
    }
  };

  return (
    <div className="flex flex-col h-[70vh] border border-zinc-800 bg-black relative" id="conversation_window">
      {/* Dynamic Conversation Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 bg-zinc-950" id="chat_header">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="md:hidden text-zinc-400 hover:text-white transition-colors cursor-pointer"
            title="Back to Inbox"
          >
            <ArrowLeft size={20} />
          </button>

          {friendProfile.photoURL ? (
            <img
              src={friendProfile.photoURL}
              alt=""
              className="w-10 h-10 object-cover border border-zinc-700 rounded-full grayscale"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="w-10 h-10 bg-zinc-800 border border-zinc-700 flex items-center justify-center font-mono text-xs uppercase text-white rounded-full">
              {friendProfile.displayName.substring(0, 2)}
            </div>
          )}

          <div>
            <h2 className="text-sm font-semibold text-white leading-none">{friendProfile.displayName}</h2>
            <span className="text-[10px] font-mono uppercase text-zinc-500 mt-1 block">
              {friendProfile.uid}
            </span>
          </div>
        </div>

        {friendProfile.bio && (
          <p className="hidden md:block text-[10px] text-zinc-450 italic font-mono max-w-sm truncate uppercase tracking-wide">
            {friendProfile.bio}
          </p>
        )}
      </div>

      {/* Messages Scroll Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-black/60 scrollbar-thin" id="messages_scroll_canvas">
        {loading ? (
          <div className="h-full flex items-center justify-center font-mono text-xs text-zinc-650 uppercase">
            Fetching Logs...
          </div>
        ) : messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center font-mono text-xs text-zinc-600 uppercase border border-dashed border-zinc-900 py-16 text-center">
            <span>Secure Tunnel Open</span>
            <span className="text-[10px] tracking-widest mt-1 text-zinc-800">Messages will load in real-time</span>
          </div>
        ) : (
          messages.map((msg, index) => {
            const isMe = msg.senderId === myId;
            return (
              <div
                key={msg.id}
                className={`flex flex-col max-w-[70%] ${
                  isMe ? "ml-auto items-end" : "mr-auto items-start"
                }`}
                id={`chat_message_${msg.id}`}
              >
                {/* Message Body Box */}
                <div
                  className={`p-3.5 border text-sm leading-relaxed rounded-sm ${
                    isMe
                      ? "bg-white text-black border-white font-medium"
                      : "bg-zinc-900 text-zinc-200 border-zinc-800"
                  }`}
                >
                  {/* Image render */}
                  {msg.type === "image" && msg.mediaUrl && (
                    <div className="mb-2 max-w-xs border border-zinc-800 bg-zinc-900">
                      <img
                        src={msg.mediaUrl}
                        alt=""
                        className="w-full h-auto max-h-60 object-contain block grayscale hover:grayscale-0 transition-all duration-300"
                        referrerPolicy="no-referrer"
                      />
                    </div>
                  )}

                  {/* Video render */}
                  {msg.type === "video" && msg.mediaUrl && (
                    <div className="mb-2 max-w-xs border border-zinc-800 bg-zinc-900">
                      <video
                        src={msg.mediaUrl}
                        controls
                        muted
                        className="w-full h-auto max-h-60 object-contain block focus:outline-none"
                      />
                    </div>
                  )}

                  {msg.text && <p className="whitespace-pre-wrap select-text">{msg.text}</p>}
                </div>

                {/* Receipts Details */}
                <div className="flex items-center gap-1.5 mt-1 text-[8px] font-mono text-zinc-500 uppercase">
                  <span>
                    {msg.createdAt?.toDate
                      ? msg.createdAt.toDate().toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })
                      : "Sending..."}
                  </span>
                  {isMe && (
                    <>
                      <span>•</span>
                      <span className="flex items-center gap-0.5">
                        {msg.read ? (
                          <>
                            <Eye size={10} className="text-zinc-400" /> Read
                          </>
                        ) : (
                          <>
                            <EyeOff size={10} className="text-zinc-600" /> Sent
                          </>
                        )}
                      </span>
                    </>
                  )}
                </div>
              </div>
            );
          })
        )}
        <div ref={conversationEndRef} />
      </div>

      {/* Attachment / Preview Ribbon */}
      {(mediaPreview || attachmentError) && (
        <div className="absolute bottom-[65px] inset-x-0 bg-zinc-950 border-t border-zinc-800 p-3 flex items-center justify-between z-10">
          <div className="flex items-center gap-3">
            {mediaPreview && (
              <div className="w-12 h-12 border border-zinc-800 bg-black overflow-hidden relative group">
                {mediaType === "image" ? (
                  <img src={mediaPreview} alt="" className="w-full h-full object-cover grayscale" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-zinc-900 font-mono text-[9px] uppercase text-zinc-450">
                    Video
                  </div>
                )}
              </div>
            )}
            <div>
              <span className="text-xs uppercase font-mono text-zinc-300 block">
                {attachmentError ? "Error Blocked" : "Attachment Selected"}
              </span>
              <p className="text-[10px] font-mono text-zinc-500 max-w-sm truncate uppercase mt-0.5">
                {attachmentError ? attachmentError : `Ready to transmit ${mediaType}`}
              </p>
            </div>
          </div>
          <button
            onClick={clearAttachment}
            className="text-zinc-500 hover:text-white p-1 cursor-pointer"
            title="Cancel attachment"
          >
            <X size={16} />
          </button>
        </div>
      )}

      {/* Emoji list Popover drawer Drawer */}
      {showEmojiGrid && (
        <div className="absolute bottom-[65px] right-4 bg-zinc-950 border border-zinc-800 p-3 shadow-xl grid grid-cols-8 gap-2 z-20 rounded-sm">
          {POPULAR_EMOJIS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={() => handleInsertEmoji(emoji)}
              className="text-lg hover:bg-zinc-900 p-1 rounded transition-colors cursor-pointer"
            >
              {emoji}
            </button>
          ))}
        </div>
      )}

      {/* Custom Private Message Control Form */}
      <form onSubmit={handleSendMessage} className="flex border-t border-zinc-800 p-3 bg-zinc-950 gap-2 items-center" id="chat_form">
        {/* Attachment Options */}
        <div className="flex items-center gap-1 shrink-0">
          {/* Photos */}
          <label
            htmlFor="photo_attachment_picker"
            className="p-2 text-zinc-400 hover:text-white cursor-pointer transition-colors"
            title="Attach Photo"
          >
            <Image size={18} />
            <input
              id="photo_attachment_picker"
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handlePhotoSelect}
            />
          </label>

          {/* Videos */}
          <label
            htmlFor="video_attachment_picker"
            className="p-2 text-zinc-400 hover:text-white cursor-pointer transition-colors"
            title="Attach Private Video"
          >
            <Film size={18} />
            <input
              id="video_attachment_picker"
              type="file"
              accept="video/*"
              className="hidden"
              onChange={handleVideoSelect}
            />
          </label>

          {/* Emojis Grid Drawer Toggle */}
          <button
            type="button"
            onClick={() => setShowEmojiGrid(!showEmojiGrid)}
            className={`p-2 transition-colors cursor-pointer ${
              showEmojiGrid ? "text-white" : "text-zinc-400 hover:text-white"
            }`}
            title="Insert Emoji"
          >
            <Smile size={18} />
          </button>
        </div>

        {/* Unified Input Box */}
        <input
          id="private_chat_text_input"
          type="text"
          className="flex-1 bg-black border border-zinc-800 rounded-sm px-4 py-2 text-white text-sm focus:outline-none focus:border-zinc-500 placeholder-zinc-600"
          placeholder="ENTER MESSAGE..."
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
        />

        {/* Submit */}
        <button
          id="send_private_msg_btn"
          type="submit"
          className="bg-white text-black p-2 px-3 hover:bg-zinc-200 transition-colors shrink-0 flex items-center justify-center cursor-pointer"
          title="Send"
        >
          <Send size={15} />
        </button>
      </form>
    </div>
  );
}
